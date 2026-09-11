#!/usr/bin/env node
import { createCoupon } from './commands/createCoupon.js';
import { applyCoupon } from './commands/applyCoupon.js';
import { applyCoupons } from './commands/applyCoupons.js';
import { cancelOrder } from './commands/cancelOrder.js';
import { getCoupon } from './commands/getCoupon.js';
import pool from './db.js';

const [, , cmd, ...args] = process.argv;

async function main() {
  switch (cmd) {
    case 'create-coupon': {
      const [
        code, discountType, discountValue, minSpend, expiresAt, usageLimit,
        maxDiscountAmount, usageLimitPerUser,
      ] = args;
      console.log(await createCoupon(
        code, discountType, Number(discountValue), Number(minSpend), expiresAt, Number(usageLimit),
        maxDiscountAmount ? Number(maxDiscountAmount) : null,
        usageLimitPerUser ? Number(usageLimitPerUser) : null
      ));
      break;
    }
    case 'apply-coupon': {
      const [cartTotal, code, userId] = args;
      console.log(await applyCoupon(Number(cartTotal), code, userId ?? null));
      break;
    }
    case 'apply-coupons': {
      // usage: apply-coupons <cartTotal> <code1>,<code2> [userId]
      const [cartTotal, codes, userId] = args;

      const couponCodes = codes.split(',');

      const preview = await applyCoupons(
        Number(cartTotal),
        couponCodes,
        userId ?? null,
        false
      );

      console.log(`Valid coupons: ${preview.validCoupons.join(', ')}`);

      if (preview.invalidCoupons.length > 0) {
        for (const coupon of preview.invalidCoupons) {
          console.log(`${coupon.code}: ${coupon.reason}`);
        }
      }

      console.log(`Discount: ${preview.discountAmount}`);
      console.log(`Final total: ${preview.finalTotal}`);

      process.stdout.write('Proceed with this order? (y/n): ');

      const answer = await new Promise((resolve) => {
        process.stdin.once('data', (data) => {
          resolve(data.toString().trim().toLowerCase());
        });
      });

      if (answer !== 'y' && answer !== 'yes') {
        console.log('Order cancelled. No coupons were consumed.');
        break;
      }

      const result = await applyCoupons(
        Number(cartTotal),
        couponCodes,
        userId ?? null,
        true
      );

      console.log(result);
      break;
    }
    case 'cancel-order': {
      const [orderId] = args;
      console.log(await cancelOrder(orderId));
      break;
    }
    case 'get-coupon': {
      const [code] = args;
      console.log(await getCoupon(code));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Usage: coupon <create-coupon|apply-coupon|apply-coupons|cancel-order|get-coupon> [args]');
      process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
