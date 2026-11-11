export type Lang = 'en' | 'es';
export type Status = 'free' | 'busy' | 'away';
export type Slot = 'all' | 'am' | 'pm' | 'custom';
export type CalMode = 'main' | 'own';
export type Rsvp = 'yes' | 'maybe' | 'no';
export type PlanType = 'dinner' | 'drinks' | 'party' | 'trip' | 'gym' | 'movie' | 'coffee' | 'other';
export const PLAN_TYPES: PlanType[] = ['dinner', 'drinks', 'party', 'trip', 'gym', 'movie', 'coffee', 'other'];

export interface Profile {
  id: string;
  display_name: string;
  language: Lang;
  color: string;
  email_opt_in?: boolean;
}

export interface Group {
  id: string;
  name: string;
  goal_count: number;
  goal_period: 'week' | 'month';
  min_people: number;
  invite_code: string;
  created_by: string;
}

export interface Member {
  user_id: string;
  calendar_mode: CalMode;
  profile: Profile;
}

export interface TimeSlot {
  slot: Slot;
  /** HH:MM, only for slot = custom */
  time_from?: string | null;
  time_to?: string | null;
}

export interface DayMark extends TimeSlot {
  status: Status;
  plan_id?: string | null;
}

/** date (YYYY-MM-DD) -> mark */
export type Calendar = Record<string, DayMark>;

export interface PlanOption extends TimeSlot {
  id: string;
  date: string;
}

export interface Plan {
  id: string;
  group_id: string;
  created_by: string;
  type: PlanType;
  title: string;
  place_text: string | null;
  place_maps_url: string | null;
  note: string | null;
  status: 'open' | 'confirmed';
  chosen_option_id: string | null;
  created_at: string;
  options: PlanOption[];
  invites: string[];
  responses: Record<string, Rsvp>;
  votes: Record<string, { option_ids: string[]; none_work: boolean }>;
  comments: { user_id: string; created_at: string }[];
}

export interface PlanInput {
  group_id: string;
  type: PlanType;
  title: string;
  place_text: string | null;
  place_maps_url: string | null;
  note: string | null;
  options: (TimeSlot & { date: string })[];
  invites: string[];
}

export interface Comment {
  id: string;
  plan_id: string;
  user_id: string;
  text: string;
  created_at: string;
}

export type NotifyKind = 'invited' | 'vote' | 'locked' | 'confirmed';
