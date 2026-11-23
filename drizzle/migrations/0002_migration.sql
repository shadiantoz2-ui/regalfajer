-- Teachers record attendance only; everything else is admin-only.
DROP POLICY "Staff edit students" ON public.students;
DROP POLICY "Staff delete students" ON public.students;
DROP POLICY "Staff delete attendance" ON public.attendance;
DROP POLICY "Staff add attendance" ON public.attendance;

CREATE POLICY "Admin edits students" ON public.students FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin deletes students" ON public.students FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin deletes attendance" ON public.attendance FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Admin may record any date; teachers only around today (time-zone tolerance of one day).
CREATE POLICY "Staff add attendance" ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'teacher') AND attended_on BETWEEN current_date - 1 AND current_date + 1)
  );