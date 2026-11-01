import { redirect } from 'next/navigation';

// Sensor calibration is split into Piezo Calibration and Flow Calibration.
export default async function CalibrationIndex({ searchParams }) {
  const { sensor } = await searchParams;
  redirect(sensor ? `/calibration/piezo?sensor=${sensor}` : '/calibration/piezo');
}
