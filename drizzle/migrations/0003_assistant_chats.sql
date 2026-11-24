CREATE TABLE public.assistant_chats (
  user_id uuid PRIMARY KEY,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_chats TO authenticated;
GRANT ALL ON public.assistant_chats TO service_role;
ALTER TABLE public.assistant_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin reads own assistant chat" ON public.assistant_chats FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin creates own assistant chat" ON public.assistant_chats FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin updates own assistant chat" ON public.assistant_chats FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin deletes own assistant chat" ON public.assistant_chats FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'));