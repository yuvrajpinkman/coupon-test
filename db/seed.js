import pool from '../src/db.js';

await pool.query('DELETE FROM order_coupons');
await pool.query('DELETE FROM orders');
await pool.query('DELETE FROM coupons');

await pool.query(`
  INSERT INTO coupons (code, discount_type, discount_value, min_spend, expires_at, usage_limit) VALUES
    ('SAVE10', 'percent', 10, 50, now() + interval '30 days', 100),
    ('FLAT5', 'flat', 5, 0, now() + interval '30 days', 100),
    ('LASTONE', 'percent', 20, 0, now() + interval '30 days', 1)
`);

console.log('Seed complete.');
await pool.end();
