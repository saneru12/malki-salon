# Malki Salon – Frontend + Backend (Node/Express) + MongoDB

## Setup

### Requirements
- Node.js (v18+)
- MongoDB Atlas or another MongoDB connection string in `backend/.env`

## Run Backend
```bash
cd backend
npm install
npm run dev
```

Backend runs at: `http://localhost:5000`

Health check:
- `GET http://localhost:5000/api/health`

## Run Frontend
Open `frontend/` in VS Code and run with Live Server.

## Booking System (Updated)
This version includes a real-world dual booking flow:

- **Manual hair consultation requests**
  - For services such as straightening, rebonding, relaxing, keratin, or other variable-duration hair treatments.
  - Customer uploads multiple hair photos.
  - Customer chooses a preferred **date only** and uploads reference photos.
  - Admin reviews the request and sends a proposed exact date/time/duration.
  - Customer can accept the proposal or ask for another option, looping until a slot is accepted or the booking is cancelled.

- **Instant slot booking**
  - For regular fixed-duration services.
  - Real-time overlap prevention per staff member.
  - Maximum bookings per day per staff member is controlled from Settings.

- **24-hour exact slot booking**
  - For services such as **normal dressing** and **bridal dressing** when `allowAnyTimeBooking` is enabled on the service.
  - Customers can pick exact time slots across the full day.


## Staff Management (New)
This version adds a more real-world salon staff workflow inside the admin panel:

- **Staff profiles**
  - Add, edit, deactivate, or delete staff members
  - Save phone, email, joined date, image, sort order, and role
  - Configure payroll mode per staff member: `salary + commission`, `salary only`, or `commission only`
  - Set base salary, default commission %, expected working days per month, and an optional manual OT hourly rate per staff member

- **Service assignment per staff member**
  - Assign only the services a staff member can perform
  - Optional per-staff overrides for:
    - custom price
    - custom duration
    - commission %
  - Customer booking page only shows services that belong to the selected staff member

- **Attendance management**
  - Manually mark attendance by day
  - Status options: `present`, `half day`, `paid leave`, `unpaid leave`, `absent`
  - Optional in/out time and note
  - Attendance is used in payroll calculations

- **Work logs**
  - Record completed staff work manually or convert approved appointments into work logs
  - Track staff member, service, customer, source, quantity, amount, commission, and note
  - Monthly totals are used for commission and payout summaries

- **Payroll summary**
  - Monthly payroll report combines:
    - prorated base salary from attendance
    - service commission from work logs
    - manual allowances / deductions
  - Add payroll adjustments such as bonuses, advances, transport, or deductions

### New Admin Endpoints
- `GET /api/staff-management/attendance`
- `POST /api/staff-management/attendance`
- `PUT /api/staff-management/attendance/:id`
- `DELETE /api/staff-management/attendance/:id`
- `GET /api/staff-management/work-logs`
- `POST /api/staff-management/work-logs`
- `PUT /api/staff-management/work-logs/:id`
- `DELETE /api/staff-management/work-logs/:id`
- `GET /api/staff-management/appointment-candidates`
- `POST /api/staff-management/work-logs/from-appointment`
- `GET /api/staff-management/adjustments`
- `POST /api/staff-management/adjustments`
- `PUT /api/staff-management/adjustments/:id`
- `DELETE /api/staff-management/adjustments/:id`
- `GET /api/staff-management/payroll`

### Important Note About Delete
If a staff member already has appointment, attendance, work-log, or payroll history, deleting is blocked intentionally. In that case, set the profile to **Inactive** instead, so historical reports remain correct.

## Shop Delivery Workflow (New)
This version upgrades the online shop into a more real-world salon delivery flow:

- **Order approval before dispatch**
  - Customer places an order from the shop.
  - Salon approves the order from the admin panel before dispatching it.

- **Courier handover + tracking**
  - Admin can add:
    - courier service name
    - tracking number
    - tracking URL (optional)
    - expected delivery date
  - Admin can mark the order as:
    - `confirmed`
    - `shipped` (handed to courier)
    - `out_for_delivery`
    - `delivered`
    - `delivery_issue`
    - `completed`
    - `cancelled`

- **Customer delivery tracking**
  - Customer sees the delivery details inside **My Account**.
  - Courier details, tracking number, expected delivery date, and status timeline are shown.
  - Important delivery updates are also pushed into the existing customer/admin Messages inbox.

- **Customer received / not received confirmation**
  - After dispatch, customer can send:
    - `Item received`
    - `Item not received`
  - Customer can also send follow-up messages for missing parcels.
  - Admin can reply from the Shop Orders section.

### New Order / Delivery Endpoints
- `PUT /api/orders/me/:id/delivery-feedback`
- `POST /api/orders/me/:id/delivery-followup`
- `POST /api/orders/admin/:id/delivery-reply`

## Verified Shop Reviews (New)
This version now adds a real-world **verified rating flow** for online shop orders:

- Review box becomes visible in **My Account** after the order reaches the delivered stage
- Review submission unlocks after the customer presses **Item received** or **Item not received**
- One verified public review per order, with edit/update support
- Review form includes:
  - overall 1–5 star rating
  - optional title and review text
  - optional aspect ratings for product quality, delivery handling, and salon support
  - optional recommend / not recommend flag
- Public **Trustpilot-style summary widget** is shown on the Shop page for all visitors (logged in or not)
- Widget shows:
  - average score
  - total verified reviews
  - rating breakdown
  - paged recent review cards

### New Review Endpoints
- `GET /api/reviews/shop`
- `PUT /api/reviews/orders/:id`

## Admin Panel
Open: `frontend/admin/index.html`

Default credentials are seeded automatically on first run (change in `backend/.env`):
- `ADMIN_EMAIL` (default: `admin@malkisalon.local`)
- `ADMIN_PASSWORD` (default: `admin1234`)

Admin can manage:
- Appointments and manual-review proposal workflow
- Services (including booking mode, 24-hour option, and photo requirement)
- Packages / Gallery / Staff / Products / Orders / Messages
- Booking and contact settings

## Uploads
Booking reference photos are saved by the backend under:
- `backend/uploads/booking-photos/`

They are served from:
- `/uploads/...`

## Customer Area
Customer pages:
- `frontend/customer-login.html`
- `frontend/customer-dashboard.html`

Customer can:
- Register / login
- Edit profile
- View bookings, salon proposals, and detailed courier delivery status
- Accept / reject proposed manual-review time slots
- Cancel eligible bookings and eligible shop orders before dispatch
- Send and receive admin messages
- Confirm whether shop items were received or not received
