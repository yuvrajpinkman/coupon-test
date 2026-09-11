import pool from '../db.js';

export async function applyCoupons(cartTotal, codes, userId = null, confirmed = false) {
  if (!Number.isFinite(cartTotal) || cartTotal < 0) {
    throw new Error('Cart total must be 0 or greater');
  }

  if (!Array.isArray(codes) || codes.length === 0) {
    throw new Error('At least one coupon code is required');
  }

  if (codes.length > 2) {
    throw new Error('You can apply at most 2 coupons');
  }

  const uniqueCodes = [...new Set(codes)];

  if (uniqueCodes.length !== codes.length) {
    throw new Error('The same coupon cannot be applied twice');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const coupons = [];

    for (const code of codes) {
      const result = await client.query(
        `SELECT
           code,
           discount_type,
           discount_value,
           min_spend,
           expires_at,
           usage_limit,
           times_used,
           max_discount_amount,
           usage_limit_per_user
         FROM coupons
         WHERE code = $1
         FOR UPDATE`,
        [code]
      );

      if (result.rows.length === 0) {
        coupons.push({
          code,
          valid: false,
          reason: `Coupon "${code}" not found`,
        });
        continue;
      }

      const coupon = result.rows[0];

      if (cartTotal < Number(coupon.min_spend)) {
        coupons.push({
          code,
          valid: false,
          reason: `Cart total must be at least ${Number(coupon.min_spend)}`,
        });
        continue;
      }

      if (new Date() > coupon.expires_at) {
        coupons.push({
          code,
          valid: false,
          reason: `Coupon "${code}" has expired`,
        });
        continue;
      }

      if (Number(coupon.times_used) >= Number(coupon.usage_limit)) {
        coupons.push({
          code,
          valid: false,
          reason: `Coupon "${code}" has reached its usage limit`,
        });
        continue;
      }

      if (coupon.usage_limit_per_user !== null && userId !== null) {
        const userUsageResult = await client.query(
          `SELECT COUNT(*) AS count
           FROM orders
           WHERE coupon_code = $1
             AND user_id = $2
             AND status <> 'cancelled'`,
          [code, userId]
        );

        if (
          Number(userUsageResult.rows[0].count) >=
          Number(coupon.usage_limit_per_user)
        ) {
          coupons.push({
            code,
            valid: false,
            reason: `User "${userId}" has reached the usage limit for coupon "${code}"`,
          });
          continue;
        }
      }

      coupons.push({
        ...coupon,
        valid: true,
      });
    }

    const validCoupons = coupons.filter((coupon) => coupon.valid);

    if (validCoupons.length === 0) {
      await client.query('ROLLBACK');

      throw new Error('No valid coupons could be applied');
    }

    const percentCoupons = validCoupons.filter(
      (coupon) => coupon.discount_type === 'percent'
    );

    const flatCoupons = validCoupons.filter(
      (coupon) => coupon.discount_type === 'flat'
    );

    if (percentCoupons.length > 1) {
      throw new Error('You can apply at most one percent coupon');
    }

    if (flatCoupons.length > 1) {
      throw new Error('You can apply at most one flat coupon');
    }

    let remainingTotal = cartTotal;
    let totalDiscount = 0;

    const appliedCodes = [];

    // Percentage coupon is applied first.
    if (percentCoupons.length === 1) {
      const coupon = percentCoupons[0];

      let discount =
        remainingTotal *
        (Number(coupon.discount_value) / 100);

      discount *= 0.98;

      if (coupon.max_discount_amount !== null) {
        discount = Math.min(
          discount,
          Number(coupon.max_discount_amount)
        );
      }

      discount = Math.min(discount, remainingTotal);
      discount =
        Math.round((discount + Number.EPSILON) * 100) / 100;

      totalDiscount += discount;
      remainingTotal -= discount;
      appliedCodes.push(coupon.code);
    }

    // Flat coupon is applied to the remaining total.
    if (flatCoupons.length === 1) {
      const coupon = flatCoupons[0];

      let discount = Math.min(
        Number(coupon.discount_value),
        remainingTotal
      );

      discount =
        Math.round((discount + Number.EPSILON) * 100) / 100;

      totalDiscount += discount;
      remainingTotal -= discount;
      appliedCodes.push(coupon.code);
    }

    totalDiscount =
      Math.round((totalDiscount + Number.EPSILON) * 100) / 100;

    const finalTotal =
      Math.round((Math.max(remainingTotal, 0) + Number.EPSILON) * 100) /
      100;

    if (!confirmed) {
      await client.query('ROLLBACK');

      return {
        confirmed: false,
        validCoupons: validCoupons.map((coupon) => coupon.code),
        invalidCoupons: coupons
          .filter((coupon) => !coupon.valid)
          .map((coupon) => ({
            code: coupon.code,
            reason: coupon.reason,
          })),
        discountAmount: totalDiscount,
        finalTotal,
        appliedCodes,
      };
    }

    const primaryCode = appliedCodes[0];

    const orderResult = await client.query(
      `INSERT INTO orders (
         cart_total,
         coupon_code,
         discount_amount,
         final_total,
         status,
         user_id
       )
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [
        cartTotal,
        primaryCode,
        totalDiscount,
        finalTotal,
        userId,
      ]
    );

    for (const code of appliedCodes) {
      await client.query(
        `UPDATE coupons
         SET times_used = times_used + 1
         WHERE code = $1`,
        [code]
      );

      await client.query(
        `INSERT INTO order_coupons (
           order_id,
           code,
           discount_amount
         )
         VALUES ($1, $2, $3)`,
        [
          orderResult.rows[0].id,
          code,
          validCoupons.find((coupon) => coupon.code === code)
            .discount_type === 'percent'
            ? totalDiscount
            : totalDiscount,
        ]
      );
    }

    await client.query('COMMIT');

    return {
      confirmed: true,
      orderId: orderResult.rows[0].id,
      discountAmount: totalDiscount,
      finalTotal,
      appliedCodes,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}