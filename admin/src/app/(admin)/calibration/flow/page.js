'use client';

import { CalibrationView } from '@/components/domain/CalibrationView';
import { withSuspense } from '@/components/ui/Filters';

export default withSuspense(() => <CalibrationView sensorType="flow" />);
