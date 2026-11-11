export type Lang = 'en' | 'es';
export type Status = 'free' | 'busy' | 'away';
export type Slot = 'all' | 'am' | 'pm';
export type CalMode = 'main' | 'own';

export interface Profile {
  id: string;
  display_name: string;
  language: Lang;
  color: string;
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

export interface DayMark {
  status: Status;
  slot: Slot;
}

/** date (YYYY-MM-DD) -> mark */
export type Calendar = Record<string, DayMark>;

export interface AvailabilityRow {
  owner_id: string;
  group_id: string | null;
  date: string;
  status: Status;
  slot: Slot;
}
