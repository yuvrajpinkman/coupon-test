# Coupon Engine CLI

## Setup

```
docker compose up -d
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
```

## Run

```
node src/cli.js create-coupon WELCOME percent 15 20 2027-01-01T00:00:00Z 50
node src/cli.js apply-coupon 100 WELCOME
node src/cli.js get-coupon WELCOME
node src/cli.js cancel-order <order-id>
```

## Implemented Features

### Base functionality

- Create coupons with percent or flat discounts
- Minimum-spend validation
- Expiry validation
- Global usage limits
- Order creation and cancellation
- Coupon usage restoration after cancellation
- Currency values rounded to 2 decimal places
- Final totals never fall below zero

### Bonus 1 : Capped percentage discounts

Percentage coupons can optionally specify a maximum discount amount.

### Bonus 2 : Per-user usage limits

Coupons can optionally specify a per-user redemption limit.
Global and per-user limits are enforced safely under concurrent requests.

### Bonus 3 : Stackable coupons

The CLI supports applying up to two coupons:

- At most one `percent` coupon
- At most one `flat` coupon
- Duplicate coupons are rejected
- Percentage coupons are applied before flat coupons
- Each applied coupon is recorded in `order_coupons`
- Cancelling a stacked order releases the usage of all applied coupons

```
node src/cli.js apply-coupons 100 SAVE10,FLAT5
```

#### Confirmation behavior

The Bonus 3 behavior was intentionally extended from the original
all-or-nothing specification:

- If both coupons are valid, they are applied immediately without
  confirmation.
- If one coupon is valid and one is invalid, the CLI displays the valid
  and invalid coupons, the calculated discount, and the final total,
  then asks the user whether to proceed.
- `y` creates the order using the valid coupon(s).
- `n` creates no order and consumes no coupon usage.
- If all coupons are invalid, the request is rejected without asking
  for confirmation.

To support this two-step preview/confirmation flow, `applyCoupons`
internally accepts a fourth `confirmed` parameter:

`applyCoupons(cartTotal, codes, userId, confirmed)`

The fourth parameter is an internal implementation detail and is not
entered as a CLI argument. The CLI first calls the function with
`confirmed = false` to generate the preview, then calls it with
`confirmed = true` after the user confirms.

This is an intentional deviation from the original Bonus 3
all-or-nothing behavior described in `PROBLEM.md`.

## Test

Run the automated test suite with:

```
npm test
```
### AI Assistance

AI assistance was used for code completion and implementation support for
the CLI and Bonus 3 feature. The AI was instructed to follow the original
specifications and avoid introducing unrelated features or changing
existing behavior.

The change to Bonus 3 confirmation behavior was my idea. I chose this
behavior based on a real-world scenario where a user may still want to
apply a valid coupon when another supplied coupon is invalid.
