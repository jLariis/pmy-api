import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentTemplate } from 'src/entities/document-template.entity';
import { DocumentTemplateVersion } from 'src/entities/document-template-version.entity';
import { TemplateVariableDef } from 'src/entities/template-variable-def.entity';
import { TemplateStore } from './template-store.service';
import { seedEmailTemplates } from './seeds/email-templates.seed';
import { seedPdfTemplates } from './seeds/pdf-templates.seed';
import { seedExcelTemplates } from './seeds/excel-templates.seed';

/**
 * Garantiza que las plantillas de documentos (correo/PDF/Excel) existan en la
 * base de datos al arrancar la app, sin depender de que alguien corra
 * `npm run seed` manualmente tras cada deploy.
 *
 * Causa raíz que esto arregla: `runSeeds()` (src/seed/seed-utils.ts) solo se
 * ejecuta manualmente. Si se agrega/ajusta una plantilla (p.ej. `dex03_report`)
 * y no se re-corre el seed en producción, `TemplateStore.getActive()` lanza y
 * el sistema cae al `FallbackRenderer` ("Notificación PMY / plantilla no
 * disponible"). Este seeder corre los mismos seeds (idempotentes, upsert por
 * `code`) en `onApplicationBootstrap`, así que el arranque los repara solo.
 *
 * - Los seeds respetan ediciones del usuario: solo refrescan una versión si su
 *   `changelog` sigue empezando con "Seed" (ver seedEmailTemplates).
 * - Nunca debe tumbar el arranque: cualquier error se atrapa y se loguea.
 * - Se puede desactivar con `SEED_TEMPLATES_ON_BOOT=false` (p.ej. en tests e2e
 *   que gestionan su propia data).
 */
@Injectable()
export class TemplatesBootstrapSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(TemplatesBootstrapSeeder.name);

  constructor(
    @InjectRepository(DocumentTemplate) private readonly tplRepo: Repository<DocumentTemplate>,
    @InjectRepository(DocumentTemplateVersion) private readonly verRepo: Repository<DocumentTemplateVersion>,
    @InjectRepository(TemplateVariableDef) private readonly varRepo: Repository<TemplateVariableDef>,
    private readonly templateStore: TemplateStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SEED_TEMPLATES_ON_BOOT === 'false') {
      this.logger.log('Auto-seed de plantillas deshabilitado (SEED_TEMPLATES_ON_BOOT=false)');
      return;
    }
    try {
      const repos = { tplRepo: this.tplRepo, verRepo: this.verRepo, varRepo: this.varRepo };
      await seedEmailTemplates(repos);
      await seedPdfTemplates(repos);
      await seedExcelTemplates(repos);
      this.templateStore.invalidate();
      this.logger.log('Plantillas verificadas/sembradas en arranque');
    } catch (e: any) {
      // NUNCA debe tumbar el arranque de la app: un fallo aquí es recuperable
      // (se puede re-sembrar manualmente) y no debe impedir levantar el servicio.
      this.logger.error(`Auto-seed de plantillas falló en el arranque (se continúa): ${e?.message}`, e?.stack);
    }
  }
}
