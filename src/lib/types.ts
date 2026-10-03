export type UserRole = "manager" | "cleaner";
export type RoomStatus = "clean" | "dirty" | "cleaning" | "inspected" | "out_of_service";
export type ReservationStatus =
  | "pending" | "confirmed" | "rejected" | "cancelled" | "checked_in" | "checked_out";
export type WorkOrderType = "checkout_clean" | "stayover" | "deep_clean" | "maintenance" | "inspection";
export type WorkOrderStatus = "pending" | "in_progress" | "done" | "verified" | "issue";
export type Priority = "low" | "normal" | "high" | "urgent";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  active: boolean;
}

export interface Room {
  id: string;
  number: string;
  name: string | null;
  room_type: string;
  floor: number;
  capacity: number;
  status: RoomStatus;
  ical_token: string;
  notes: string | null;
  active: boolean;
  updated_at: string;
}

export interface BookingSource {
  id: string;
  name: string;
  color: string;
  auto_confirm: boolean;
}

export interface IcalFeed {
  id: string;
  room_id: string;
  source_id: string;
  url: string;
  active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface Reservation {
  id: string;
  room_id: string | null;
  source_id: string | null;
  external_uid: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guests: number;
  check_in: string;
  check_out: string;
  status: ReservationStatus;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done?: boolean;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  order_type: WorkOrderType;
  items: ChecklistItem[];
}

export interface WorkOrder {
  id: string;
  room_id: string;
  assigned_to: string | null;
  created_by: string | null;
  reservation_id: string | null;
  order_type: WorkOrderType;
  priority: Priority;
  scheduled_date: string;
  status: WorkOrderStatus;
  instructions: string | null;
  checklist: ChecklistItem[];
  rating: number | null;
  started_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderNote {
  id: string;
  work_order_id: string;
  author_id: string | null;
  body: string;
  is_issue: boolean;
  photo_path: string | null;
  created_at: string;
}

export interface DashboardStats {
  total_rooms: number;
  room_nights_sold: number;
  occupancy_pct: number | null;
  revenue: number;
  reservations_by_status: Record<string, number>;
  reservations_by_source: { source: string; color: string; count: number }[];
  occupancy_series: { day: string; occupied: number }[];
  orders_total: number;
  orders_done: number;
  orders_issue: number;
  avg_clean_minutes: number | null;
  avg_room_rating: number | null;
  by_cleaner: { name: string; done: number; total: number; avg_minutes: number | null; notes: number }[];
  issues_by_room: { room: string; issues: number }[];
}
