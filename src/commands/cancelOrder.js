import pool from '../db.js';

/**
 * Cancel an order. If a coupon was applied, its usage count should be
 * released back.
 * @param {string} orderId
 * @returns {Promise<string>} a result message
 * @throws {Error} if the order doesn't exist or is already cancelled
 */
export async function cancelOrder(orderId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the order so two simultaneous cancellations
    // cannot both release the coupon usage.
    const orderResult = await client.query(
      `SELECT
         id,
         coupon_code,
         status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error(`Order "${orderId}" not found`);
    }

    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      throw new Error(`Order "${orderId}" is already cancelled`);
    }

    const couponResult = await client.query(
      `SELECT code FROM order_coupons WHERE order_id = $1`,
      [orderId]
    );

    for (const coupon of couponResult.rows) {
      await client.query(
        `UPDATE coupons
         SET times_used = GREATEST(times_used - 1, 0)
         WHERE code = $1`,
         [coupon.code]
      );
    }

    await client.query(
      `UPDATE orders
       SET status = 'cancelled'
       WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');

    return `Order "${orderId}" cancelled successfully`;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}