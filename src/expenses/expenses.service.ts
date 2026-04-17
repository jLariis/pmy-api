import { BadRequestException, Injectable } from '@nestjs/common';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Expense, User, Vehicle } from 'src/entities';
import { Between, In, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { ExpenseCategory } from 'src/common/enums/category-enum';
import { Frequency } from 'src/common/enums/frequency-enum';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
    @InjectRepository(Vehicle)
    private vehicleRepository: Repository<Vehicle>,
    @InjectRepository(User)
    private userRepository: Repository<User>
  ){}

  async create(createExpenseDto: Expense) {
    const newExpense = await this.expenseRepository.create(createExpenseDto);
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
      }
    });

    return expenses;
  }

  async findBySubsidiaryAndDates(subsidiaryId: string, firstDay: Date, lastDay: Date) {
    return await this.expenseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        },
        date: Between(firstDay, lastDay)
      }
    });
  }

  async update(id: string, updateExpenseDto: UpdateExpenseDto) {
    return `This action updates a #${id} expense`;
  }

  async remove(id: string) {
    return `This action removes a #${id} expense`;
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
          category: ExpenseCategory.Combustible, 
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
