Malki Salon - Shop Order Item Cancellation Update

What was added
- Customers can now cancel selected shop order items from My Account > My Orders.
- Works for:
  - multiple different item types in the same order
  - multiple quantities of the same item line
  - cancelling only some units while keeping the remaining units active
- Customers can cancel the full remaining order only until the salon approves it.
- Cancelled item quantities are automatically returned to product stock.
- Order totals are recalculated automatically:
  - original total
  - cancelled value
  - current total
- Admin shop order views now show remaining quantities and cancelled values clearly.

Customer flow
1. Customer places a shop order.
2. In My Account > My Orders, before the salon approves the order, the customer can:
   - enter cancel quantities per item line
   - cancel selected items together
   - cancel the full remaining order
3. The order history stores each item cancellation event.

Technical notes
- Added per-line order item tracking with lineId and cancelledQty.
- Added itemCancellationHistory to orders.
- Existing old orders are handled automatically with fallback line IDs.
