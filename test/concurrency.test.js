import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { createCoupon } from '../src/commands/createCoupon.js';
import { applyCoupon } from '../src/commands/applyCoupon.js';

test('global usage limit is safe under concurrent applications', async () => {
    const code = 'CONCURRENT1';

    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM coupons');

    await createCoupon(
        code,
        'percent',
        10,
        0,
        '2027-01-01T00:00:00Z',
        1
    );

    const attempts = Array.from({ length: 10 }, () =>
        applyCoupon(100, code)
            .then(() => true)
            .catch(() => false)
    );

    const results = await Promise.all(attempts);

    const successfulAttempts = results.filter(Boolean).length;

    const couponResult = await pool.query(
        'SELECT times_used FROM coupons WHERE code = $1',
        [code]
    );

    const orderResult = await pool.query(
        `SELECT COUNT(*) AS count
     FROM orders
     WHERE coupon_code = $1
       AND status <> 'cancelled'`,
        [code]
    );

    assert.equal(successfulAttempts, 1);
    assert.equal(Number(couponResult.rows[0].times_used), 1);
    assert.equal(Number(orderResult.rows[0].count), 1);
});

test('per-user usage limit is safe under concurrent applications', async () => {
    const code = 'CONCURRENT_USER';

    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM coupons');

    await createCoupon(
        code,
        'percent',
        10,
        0,
        '2027-01-01T00:00:00Z',
        10,
        null,
        1
    );

    const attempts = Array.from({ length: 10 }, () =>
        applyCoupon(100, code, 'user1')
            .then(() => true)
            .catch(() => false)
    );

    const results = await Promise.all(attempts);

    const successfulAttempts = results.filter(Boolean).length;

    const orderResult = await pool.query(
        `SELECT COUNT(*) AS count
     FROM orders
     WHERE coupon_code = $1
       AND user_id = $2
       AND status <> 'cancelled'`,
        [code, 'user1']
    );

    const couponResult = await pool.query(
        'SELECT times_used FROM coupons WHERE code = $1',
        [code]
    );

    assert.equal(successfulAttempts, 1);
    assert.equal(Number(orderResult.rows[0].count), 1);
    assert.equal(Number(couponResult.rows[0].times_used), 1);
});

test('failed transaction rolls back coupon usage', async () => {
    const code = 'ROLLBACK1';

    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM coupons');

    await createCoupon(
        code,
        'percent',
        10,
        0,
        '2027-01-01T00:00:00Z',
        5
    );

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Lock the coupon just like applyCoupon does.
        await client.query(
            `SELECT code
       FROM coupons
       WHERE code = $1
       FOR UPDATE`,
            [code]
        );

        // Make a change inside the transaction.
        await client.query(
            `UPDATE coupons
       SET times_used = times_used + 1
       WHERE code = $1`,
            [code]
        );

        // Deliberately cause an error.
        await client.query(
            `INSERT INTO coupons (
         code,
         discount_type,
         discount_value,
         min_spend,
         expires_at,
         usage_limit
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [code, 'percent', 10, 0, '2027-01-01T00:00:00Z', 5]
        );

        assert.fail('Expected duplicate coupon insert to fail');
    } catch (error) {
        await client.query('ROLLBACK');
    } finally {
        client.release();
    }

    const result = await pool.query(
        `SELECT times_used
     FROM coupons
     WHERE code = $1`,
        [code]
    );

    assert.equal(Number(result.rows[0].times_used), 0);
});