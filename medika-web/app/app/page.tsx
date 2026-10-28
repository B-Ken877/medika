"use client";

/** Role router: renders the patient or doctor dashboard from one URL. */
import dynamic from "next/dynamic";
import { useAuth } from "@/lib/auth/context";

const PatientDashboard = dynamic(() => import("@/components/consultation/PatientDashboard"), {
  ssr: false,
  loading: () => <div className="skeleton skeleton-row" style={{ height: 120 }} />,
});
const DoctorDashboard = dynamic(() => import("@/components/consultation/DoctorDashboard"), {
  ssr: false,
  loading: () => <div className="skeleton skeleton-row" style={{ height: 120 }} />,
});

export default function AppHome() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "doctor") return <DoctorDashboard />;
  return <PatientDashboard />;
}
