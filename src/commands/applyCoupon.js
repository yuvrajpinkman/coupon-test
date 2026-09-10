import pool from '../db.js';

/**
 * Apply a coupon to a new order.
 * @param {number} cartTotal
 * @param {string} code
 * @param {string|null} [userId]
 * @returns {Promise<{orderId: string, discountAmount: number, finalTotal: number}>}
 * @throws {Error} if the coupon is invalid for the order
 */
export async function applyCoupon(cartTotal, code, userId = null) {
  if (!Number.isFinite(cartTotal) || cartTotal < 0) {
    throw new Error('Cart total must be 0 or greater');
  }

  if (!code || typeof code !== 'string') {
    throw new Error('Coupon code is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock this coupon row so two simultaneous redemptions
    // cannot both consume the same remaining usage.
    const couponResult = await client.query(
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

    if (couponResult.rows.length === 0) {
      throw new Error(`Coupon "${code}" not found`);
    }

    const coupon = couponResult.rows[0];

    if (cartTotal < Number(coupon.min_spend)) {
      throw new Error(
        `Cart total must be at least ${Number(coupon.min_spend)} to use coupon "${code}"`
      );
    }

    if (new Date() > coupon.expires_at) {
      throw new Error(`Coupon "${code}" has expired`);
    }

    if (Number(coupon.times_used) >= Number(coupon.usage_limit)) {
      throw new Error(`Coupon "${code}" has reached its usage limit`);
    }

    // Bonus 2: per-user usage limit.
    if (coupon.usage_limit_per_user !== null && userId !== null) {
      const userUsageResult = await client.query(
        `SELECT COUNT(*) AS count
         FROM orders
         WHERE coupon_code = $1
           AND user_id = $2
           AND status <> 'cancelled'`,
        [code, userId]
      );

      const userTimesUsed = Number(userUsageResult.rows[0].count);

      if (userTimesUsed >= Number(coupon.usage_limit_per_user)) {
        throw new Error(
          `User "${userId}" has reached the usage limit for coupon "${code}"`
        );
      }
    }

    let discountAmount;

    if (coupon.discount_type === 'percent') {
      const rawDiscount =
        cartTotal * (Number(coupon.discount_value) / 100);

      // Repository rule from AGENTS.md:
      // percentage discounts receive the 0.98 adjustment.
      discountAmount = rawDiscount * 0.98;

      if (coupon.max_discount_amount !== null) {
        discountAmount = Math.min(
          discountAmount,
          Number(coupon.max_discount_amount)
        );
      }
    } else {
      discountAmount = Number(coupon.discount_value);
    }

    // A coupon can never reduce the cart below zero.
    discountAmount = Math.min(discountAmount, cartTotal);

    // Standard currency rounding.
    discountAmount = Math.round((discountAmount + Number.EPSILON) * 100) / 100;

    const finalTotal =
      Math.round(
        (cartTotal - discountAmount + Number.EPSILON) * 100
      ) / 100;

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
      [cartTotal, code, discountAmount, finalTotal, userId]
    );

    await client.query(
      `UPDATE coupons
       SET times_used = times_used + 1
       WHERE code = $1`,
      [code]
    );

    await client.query('COMMIT');

    return {
      orderId: orderResult.rows[0].id,
      discountAmount,
      finalTotal,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}