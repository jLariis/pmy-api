import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subsidiary } from 'src/entities';
import { Repository } from 'typeorm';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';
import { UpdateSubsidiaryDto } from './dto/update-subsidiary.dto';

@Injectable()
export class SubsidiariesService {
  constructor(
    @InjectRepository(Subsidiary)
    private subsidiaryRepository: Repository<Subsidiary>
  ){}

  async create(dto: CreateSubsidiaryDto, userId?: string){
    const subsidiary = this.subsidiaryRepository.create({ ...dto, createdById: userId ?? null });
    return await this.subsidiaryRepository.save(subsidiary);
  }

  async update(id: string, dto: UpdateSubsidiaryDto){
    const subsidiary = await this.subsidiaryRepository.findOne({ where: { id } });
    if (!subsidiary) throw new NotFoundException('Sucursal no encontrada.');
    Object.assign(subsidiary, dto);
    return await this.subsidiaryRepository.save(subsidiary);
  }

  async findAll(){
    return await this.subsidiaryRepository.find({
      order: {
        name: "ASC"
      }
    });
  }

  async findById(id: string): Promise<Subsidiary>{
    return await this.subsidiaryRepository.findOneBy({id});
  }

  async getByName(name: string){
    const city = await this.subsidiaryRepository.findOne({ where: { name } })
    return city;
  }

  async delete(id: string) {
    const subsidiary = await this.subsidiaryRepository.findOne({ where: { id } });
    if (!subsidiary) throw new NotFoundException('Sucursal no encontrada.');
    try {
      return await this.subsidiaryRepository.delete(id);
    } catch (err: any) {
      // FK: la sucursal está referenciada (envíos, choferes, etc.) → no se puede borrar físicamente.
      if (err?.code === 'ER_ROW_IS_REFERENCED_2' || err?.errno === 1451) {
        throw new ConflictException(
          'La sucursal tiene registros asociados; desactívala en lugar de eliminarla.',
        );
      }
      throw err;
    }
  }
}
