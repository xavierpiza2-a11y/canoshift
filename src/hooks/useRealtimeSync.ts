import { useEffect, useState } from 'react';
import { realtimeClient, RealtimeStatus, RealtimeMessage } from '../services/realtimeClient';

export function useRealtimeSync(onMessage?: (msg: RealtimeMessage) => void) {
  const [status, setStatus] = useState<RealtimeStatus>(realtimeClient.getStatus());

  useEffect(() => {
    const unsubStatus = realtimeClient.onStatusChange((s) => {
      setStatus(s);
    });

    let unsubMsg: (() => void) | undefined;
    if (onMessage) {
      unsubMsg = realtimeClient.onMessage(onMessage);
    }

    return () => {
      unsubStatus();
      if (unsubMsg) unsubMsg();
    };
  }, [onMessage]);

  return { status, isConnected: status === 'connected' };
}
