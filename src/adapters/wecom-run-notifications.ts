import { createDocumentRunNotificationService, NotificationDeliveryUncertainError } from '../application/runs/document-run-notification-service.js';
import { createDocumentNotificationStore } from '../storage/document-notification-store.js';

export function createWecomRunNotifications(directory: string) {
  return createDocumentRunNotificationService({
    repository: createDocumentNotificationStore(directory),
    async send(webhook, content) {
      let response: Response;
      try { response = await fetch(webhook, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } }),
      }); } catch { throw new NotificationDeliveryUncertainError('notification acknowledgement unavailable'); }
      if (response.status >= 500) throw new NotificationDeliveryUncertainError('notification acknowledgement unavailable');
      if (!response.ok) throw new Error('notification delivery failed');
      let result: { errcode?: number };
      try { result = await response.json() as { errcode?: number }; }
      catch { throw new NotificationDeliveryUncertainError('notification acknowledgement unavailable'); }
      if (!result || typeof result.errcode !== 'number') throw new NotificationDeliveryUncertainError('notification acknowledgement unavailable');
      if (result.errcode !== 0) throw new Error('notification rejected');
    },
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now: () => new Date().toISOString(),
  });
}
