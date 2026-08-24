import { BadRequestException, Injectable } from '@nestjs/common';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Expense, User, Vehicle, ExpenseCategory } from 'src/entities';
import { In, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { Frequency } from 'src/common/enums/frequency-enum';
import { toHermosilloDateString } from 'src/common/utils';
import { proratedAmountInRange } from 'src/common/expense-proration.util';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
    @InjectRepository(Vehicle)
    private vehicleRepository: Repository<Vehicle>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(ExpenseCategory)
    private categoryRepo: Repository<ExpenseCategory>
  ){}

  async create(createExpenseDto: Expense) {
    createExpenseDto.date = toHermosilloDateString(createExpenseDto.date || new Date());

    const hasStart = !!createExpenseDto.periodStart;
    const hasEnd = !!createExpenseDto.periodEnd;
    if (hasStart !== hasEnd) {
      throw new BadRequestException('periodStart y periodEnd deben especificarse juntos.');
    }
    if (hasStart && hasEnd) {
      const start = toHermosilloDateString(createExpenseDto.periodStart!);
      const end = toHermosilloDateString(createExpenseDto.periodEnd!);
      if (start > end) {
        throw new BadRequestException('periodStart no puede ser posterior a periodEnd.');
      }
      createExpenseDto.periodStart = start;
      createExpenseDto.periodEnd = end;
    }

    const newExpense = this.expenseRepository.create(createExpenseDto);
    return await this.expenseRepository.save(newExpense);
  }

  async findAll() {
    return await this.expenseRepository.find({order: {date: 'ASC'}});
  }

  async findOne(id: string) {
    return await this.expenseRepository.findOneBy({id});
  }

  async findBySubsidiary(subsidiaryId: string) {
    const expenses = await this.expenseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      },
      order: {
        date: 'DESC'
      },
      relations: ['vehicle', 'category']
    });

    return expenses;
  }

  /**
   * Gastos que CONTRIBUYEN al rango [firstDay, lastDay] (día calendario, inclusivo).
   * A diferencia de un `date BETWEEN`, incluye gastos recurrentes cuyo período se solapa
   * con el rango aunque se hayan registrado fuera de él (Nómina/Renta/mensuales/semanales),
   * y agrega `proratedAmount`: la porción del gasto que cae dentro del rango.
   * Mismo criterio que el Estado de Resultados (`resports.service`) y el Dashboard KPI.
   */
  async findBySubsidiaryAndDates(subsidiaryId: string, firstDay: string, lastDay: string) {
    const candidates = await this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.category', 'category')
      .where('expense.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere(
        '((expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :lastDay AND expense.periodEnd >= :firstDay) OR ((expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :firstDay AND :lastDay))',
        { firstDay, lastDay },
      )
      .getMany();

    return candidates
      .map((exp) => ({
        ...exp,
        proratedAmount: proratedAmountInRange(
          { amount: exp.amount, date: exp.date, periodStart: exp.periodStart, periodEnd: exp.periodEnd },
          firstDay,
          lastDay,
        ),
      }))
      .filter((row) => row.proratedAmount > 0);
  }

  async update(id: string, updateExpenseDto: UpdateExpenseDto) {
    return `This action updates a #${id} expense`;
  }

  async remove(id: string) {
    return await this.expenseRepository.delete(id);
  }

  async importFromExcel(file: Express.Multer.File, subsidiaryId: string, userId: string) {
    console.log('🚀 ~ Archivo recibido:', file.originalname);

    try {
      // 1. Consultar el usuario para obtener su nombre (UNA sola consulta)
      const user = await this.userRepository.findOne({ where: { id: userId } });
      
      // Ajusta 'name' o 'firstName' + 'lastName' según las columnas reales de tu entidad User
      const responsibleName = user ? `${user.name}` : 'Usuario Importador';

      // 2. Leer el Excel desde memoria
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (!jsonData || jsonData.length === 0) {
        throw new BadRequestException('El archivo Excel está vacío');
      }

      // 3. Extraer TODAS las placas únicas del Excel 
      const placasUnicas = [...new Set(
        jsonData
          .map((row: any) => row['Placas']?.toString().trim())
          .filter(Boolean)
      )];

      // 4. Buscar los vehículos en la base de datos (UNA sola consulta)
      const vehiclesInDb = await this.vehicleRepository.find({
        where: {
          plateNumber: In(placasUnicas), 
          subsidiary: { id: subsidiaryId },
        },
      });

      // 5. Crear el Diccionario (Map) de vehículos
      const vehicleMap = new Map(vehiclesInDb.map(v => [v.plateNumber, v.id]));

      // 5.1. Resolver la categoría "Combustible" una sola vez
      const combustible = await this.categoryRepo.findOne({ where: { name: 'Combustible' } });

      // 6. Procesar fila por fila y armar las entidades Expense
      const gastosAImportar = jsonData.map((row: any) => {
        const placaRaw = row['Placas']?.toString().trim();
        const monto = parseFloat(row['Monto']) || 0;
        const litros = parseFloat(row['Litros']) || 0;
        
        // Buscar el ID del vehículo en nuestro diccionario
        const vehicleId = vehicleMap.get(placaRaw) || null;

        const descriptionText = `Carga de ${litros} litros de combustible. Placa: ${placaRaw || 'N/A'}`;

        const notesText = !vehicleId && placaRaw 
          ? `⚠️ Atención: La placa ${placaRaw} no se encontró registrada en esta sucursal.` 
          : '';

        // Creamos la instancia
        return this.expenseRepository.create({
          subsidiaryId,
          amount: monto,
          categoryId: combustible?.id ?? null,
          description: descriptionText,
          vehicleId: vehicleId,
          notes: notesText,
          paymentMethod: 'Tarjeta de Débito',
          frequency: Frequency.DIARIO,
          createdById: userId,             // 👈 NUEVO: Relación directa en BD
          responsible: responsibleName,    // 👈 NUEVO: Nombre en texto del usuario
        });
      });

      // 7. Guardar todo el bloque de gastos de un solo golpe
      await this.expenseRepository.save(gastosAImportar);

      return { 
        message: 'Archivo procesado e importado correctamente',
        registrosProcesados: gastosAImportar.length,
        vehiculosNoEncontrados: gastosAImportar.filter(g => !g.vehicleId).length
      };

    } catch (error) {
      console.error('Error al importar Excel:', error);
      throw new BadRequestException('Ocurrió un error al procesar el archivo. Verifica el formato de las columnas.');
    }
  }
}
