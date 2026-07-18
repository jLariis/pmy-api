import { DataSource } from 'typeorm';
import {
  initialUsers,
} from './seed-data';
import { seedEmailTemplates } from '../documents/seeds/email-templates.seed';
import { seedPdfTemplates } from '../documents/seeds/pdf-templates.seed';
import { seedExcelTemplates } from '../documents/seeds/excel-templates.seed';
import { DocumentTemplate } from '../entities/document-template.entity';
import { DocumentTemplateVersion } from '../entities/document-template-version.entity';
import { TemplateVariableDef } from '../entities/template-variable-def.entity';
import { WhatsappTemplate } from '../entities/whatsapp-template.entity';
import { seedWhatsappTemplates } from '../whatsapp-templates/whatsapp-templates.seed';

import * as bcrypt from 'bcrypt';

export async function runSeeds(dataSource: DataSource) {
  console.log('📦 Insertando datos...');

  const saltRounds = 10;
  const usersWithHashedPasswords = await Promise.all(
    initialUsers.map(async (user) => {
      const salt = await bcrypt.genSalt(saltRounds);
      const hashedPassword = await bcrypt.hash(user.password, salt);
      return {
        ...user,
        password: hashedPassword,
      };
    })
  );


  // Best-effort: en una DB ya sembrada, los usuarios iniciales ya existen
  // (ER_DUP_ENTRY). No debe abortar el resto de seeds (plantillas, idempotentes).
  try {
    await dataSource.getRepository('user').save(usersWithHashedPasswords);
  } catch (e: any) {
    console.warn(`⚠️  Usuarios iniciales ya existían u error al insertarlos (se continúa): ${e?.message}`);
  }
  //await dataSource.getRepository('permission').save(initialPermissions);
  //await dataSource.getRepository('role').save(initialRoles);
  //await dataSource.getRepository('subsidiary').save(initialSubsidiaries);
  //await dataSource.getRepository('expense_category').save(initialExpenseCategories);
  //await dataSource.getRepository('expense').save(initialExpenses);
  //await dataSource.getRepository('driver').save(initialDrivers);
  //await dataSource.getRepository('vehicle').save(initialVehicles);
  //await dataSource.getRepository('route').save(initialRoutes);

  /*for (const shipment of initialShipments) {
    const savedShipment = await dataSource.getRepository('shipment').save(shipment);
    if (shipment.payment) {
      await dataSource.getRepository('payment').save({
        ...shipment.payment,
        shipment: savedShipment,
      });
    }
    if (shipment.statusHistory) {
      for (const status of shipment.statusHistory) {
        await dataSource.getRepository('shipment_status').save({
          ...status,
          shipment: savedShipment,
        });
      }
    }
  }*/

  console.log('📧 Insertando plantillas de correo...');
  await seedEmailTemplates({
    tplRepo: dataSource.getRepository(DocumentTemplate),
    verRepo: dataSource.getRepository(DocumentTemplateVersion),
    varRepo: dataSource.getRepository(TemplateVariableDef),
  });

  console.log('📄 Insertando plantillas de PDF...');
  await seedPdfTemplates({
    tplRepo: dataSource.getRepository(DocumentTemplate),
    verRepo: dataSource.getRepository(DocumentTemplateVersion),
    varRepo: dataSource.getRepository(TemplateVariableDef),
  });

  console.log('📊 Insertando plantillas de Excel...');
  await seedExcelTemplates({
    tplRepo: dataSource.getRepository(DocumentTemplate),
    verRepo: dataSource.getRepository(DocumentTemplateVersion),
    varRepo: dataSource.getRepository(TemplateVariableDef),
  });

  console.log('💬 Insertando plantillas de WhatsApp...');
  await seedWhatsappTemplates(dataSource.getRepository(WhatsappTemplate));

  console.log('✅ Seeds completados');
}