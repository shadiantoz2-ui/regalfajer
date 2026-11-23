CREATE TYPE public.app_role AS ENUM ('admin', 'teacher');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin', 'teacher'))
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Staff access to students and attendance
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;

CREATE POLICY "Staff read students" ON public.students FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff add students" ON public.students FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff edit students" ON public.students FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff delete students" ON public.students FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff read attendance" ON public.attendance FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff add attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff delete attendance" ON public.attendance FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

-- Single-row settings
CREATE TABLE public.app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  results_public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads settings" ON public.app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin updates settings" ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.app_settings (id, results_public) VALUES (1, false);

-- Public results: names + counts only, and only while the admin has it switched on
CREATE OR REPLACE FUNCTION public.public_results()
RETURNS TABLE (full_name text, days bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.full_name, count(a.id) AS days
  FROM public.students s
  LEFT JOIN public.attendance a ON a.student_id = s.id
  WHERE (SELECT results_public FROM public.app_settings WHERE id = 1)
  GROUP BY s.id, s.full_name
  ORDER BY days DESC, s.full_name
$$;
REVOKE ALL ON FUNCTION public.public_results() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_results() TO anon, authenticated;

-- Live updates across devices
ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.students REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE public.students;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;