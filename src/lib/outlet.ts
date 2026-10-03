import { useOutletContext } from "react-router-dom";
import type { Lookups } from "./useLookups";

export const useHotel = () => useOutletContext<Lookups>();
