import { Badge } from "./ui";
import {
  orderStatusColor, orderStatusLabel, reservationStatusColor, reservationStatusLabel, roomStatusColor, roomStatusLabel,
} from "../lib/labels";
import type { ReservationStatus, RoomStatus, WorkOrderStatus } from "../lib/types";

export const RoomStatusBadge = ({ status }: { status: RoomStatus }) => (
  <Badge className={roomStatusColor[status]}>{roomStatusLabel[status]}</Badge>
);
export const ReservationStatusBadge = ({ status }: { status: ReservationStatus }) => (
  <Badge className={reservationStatusColor[status]}>{reservationStatusLabel[status]}</Badge>
);
export const OrderStatusBadge = ({ status }: { status: WorkOrderStatus }) => (
  <Badge className={orderStatusColor[status]}>{orderStatusLabel[status]}</Badge>
);
