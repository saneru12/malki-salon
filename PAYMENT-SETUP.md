# Malki Salon - Advance Payment Setup

This project now supports a 25% advance payment flow for approved bookings.

What is included:
- Customer can pay the required advance after a booking becomes approved.
- Supported methods: bank transfer, online transfer, crypto, and Skrill.
- Customer can upload a slip or proof file (image or PDF).
- Admin can review the uploaded proof and confirm or reject it.
- Advance payment percentage and payment destination details are editable in Admin -> Settings.

Where to configure it:
1. Open the admin panel.
2. Go to **Settings**.
3. Fill in:
   - Advance payment percentage
   - Bank account details
   - Online transfer instructions
   - Crypto wallet / network
   - Skrill email and instructions
4. Save settings.

Customer flow:
1. Customer makes a booking.
2. Booking gets approved.
3. In **My Account -> My Bookings**, the payment card appears automatically.
4. Customer selects the payment method and uploads the slip/proof.
5. Admin reviews the proof and confirms or rejects it.

Backend changes:
- Payment snapshot is stored on each appointment.
- Payment proof upload endpoint added.
- Admin payment review endpoint added.

