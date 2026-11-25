# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Identity & Privilege Escalation Prevention**:
   - Only verified Google users (`request.auth.token.email_verified == true`) can access staff resources.
   - A user cannot self-assign `admin` or `teacher` in `staff_profiles/{uid}` unless they are the bootstrapped admin (`shadiantoz171@gmail.com`) or an active `staff_accounts/{emailKey}` document exists matching their verified lowercase email and exact requested role.
   - Only an existing Admin (`isAdmin()`) can create, update, or delete `staff_accounts`, and only an Admin can delete `staff_profiles` or `students` or `attendance`.
   - `staff_accounts` contains PII (`email`); non-admin users can only `get` their own email-keyed invite document and can never `list` `staff_accounts`.
2. **Relational & Referential Integrity**:
   - An `attendance` record cannot be created unless the referenced `students/{student_id}` document exists (`exists(...)`), preventing orphaned attendance records.
   - `attendance` records require `recorded_by_uid == request.auth.uid` on creation and are immutable after creation (create or delete only).
3. **List Query Enforcement**:
   - Teachers can only `list` `attendance` records where `resource.data.recorded_by_uid == request.auth.uid`.
   - Admins can `list` all `attendance`, `students`, `staff_accounts`, and `staff_profiles`.
   - `public_results/latest` allows `get` only when `results_public == true` or `isStaff()`, and denies `list` completely.
4. **Temporal & Payload Integrity**:
   - All `createdAt` and `updatedAt` fields must equal `request.time`.
   - Document IDs must pass `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
   - Strict `hasAll` / `hasOnly` key checks on create and `affectedKeys().hasOnly(...)` on update block all shadow/ghost fields.

## 2. The "Dirty Dozen" Attack Payloads

1. **Privilege Escalation (Self-Admin)**: Non-admin user tries to create `/staff_profiles/{uid}` with `role: "admin"` without an invite. -> `PERMISSION_DENIED`.
2. **Email Spoofing**: Unverified user (`email_verified: false`) claims email `shadiantoz171@gmail.com` to access `/staff_accounts`. -> `PERMISSION_DENIED`.
3. **Shadow/Ghost Field Injection on StaffAccount**: Admin or attacker creates `/staff_accounts/x` with extra field `isSuperUser: true`. -> `PERMISSION_DENIED`.
4. **PII Enumeration**: Teacher attempts `list` on `/staff_accounts` to harvest all staff emails. -> `PERMISSION_DENIED`.
5. **Orphaned Attendance Record**: Staff attempts to create `/attendance/2026-11-24_missing` referencing nonexistent `student_id: "missing"`. -> `PERMISSION_DENIED`.
6. **Teacher Forging Another Teacher's Recording**: Teacher A attempts to create `/attendance/2026-11-24_stu1` with `recorded_by_uid: "other-teacher-uid"`. -> `PERMISSION_DENIED`.
7. **Teacher Snooping Another Teacher's Recordings**: Teacher A attempts `list` on `/attendance` without filtering `recorded_by_uid == request.auth.uid`. -> `PERMISSION_DENIED`.
8. **Teacher Deleting Student or Attendance**: Teacher attempts `delete` on `/students/{id}` or `/attendance/{id}`. -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: Staff creates `/students/{id}` with backdated `createdAt` != `request.time`. -> `PERMISSION_DENIED`.
10. **Immutable Field Mutation**: Staff updates `/students/{id}` attempting to change `createdByUid` or `createdAt`. -> `PERMISSION_DENIED`.
11. **Public Leaderboard Scraping When Closed**: Anonymous visitor attempts `get` on `/public_results/latest` when `results_public == false`. -> `PERMISSION_DENIED`.
12. **Resource Exhaustion / ID Poisoning**: Staff attempts to create `/students/{oversized_or_invalid_id}` with 200-char ID or 10KB `full_name`. -> `PERMISSION_DENIED`.
