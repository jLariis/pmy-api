import { NotificationCategory, NotificationSeverity } from 'src/entities/notification.entity';

export type Channel = 'bell' | 'email' | 'whatsapp';

export type Audience =
  | { userId: string }
  | { userIds: string[] }
  | { subsidiaryId: string; roles?: string[] }
  | { role: string }
  | { global: true };

export interface NotificationEvent {
  type: string;
  audience: Audience;
  title?: string;
  body?: string;
  icon?: string;
  severity?: NotificationSeverity;
  category?: NotificationCategory;
  link?: string;
  entityId?: string;
  subsidiaryId?: string;
  actor?: { id?: string; name?: string };
  channels?: Channel[];
  /** Contexto para plantillas de correo / WhatsApp. */
  data?: Record<string, any>;
  /** En difusiones, excluye al actor de los destinatarios (default true). */
  excludeActor?: boolean;
}
