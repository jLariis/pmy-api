import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Permission, Role, User, UserPermission } from 'src/entities';
import { PermissionEffect } from 'src/entities/user-permission.entity';
import { CreateRoleDto, SetRolePermissionsDto, SetUserPermissionsDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission) private readonly permRepo: Repository<Permission>,
    @InjectRepository(UserPermission) private readonly userPermRepo: Repository<UserPermission>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /* ============ PERMISOS (catálogo) ============ */
  async getPermissions() {
    const perms = await this.permRepo.find({ order: { groupName: 'ASC', name: 'ASC' } });
    // Agrupados para la UI (matriz por grupo).
    const groups: Record<string, Permission[]> = {};
    for (const p of perms) (groups[p.groupName] ||= []).push(p);
    return { permissions: perms, groups };
  }

  /* ============ ROLES ============ */
  async getRoles() {
    const roles = await this.roleRepo.find({ relations: ['permissions'], order: { name: 'ASC' } });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissionCodes: (r.permissions || []).map((p) => p.code),
    }));
  }

  async createRole(dto: CreateRoleDto) {
    const key = dto.key?.trim().toLowerCase();
    if (!key) throw new BadRequestException('La clave del rol es obligatoria.');
    const exists = await this.roleRepo.findOne({ where: { key } });
    if (exists) throw new ConflictException(`Ya existe un rol con la clave "${key}".`);

    const role = this.roleRepo.create({
      key,
      name: dto.name,
      description: dto.description ?? '',
      isSystem: false,
    });
    if (dto.permissionCodes?.length) {
      role.permissions = await this.permRepo.find({ where: { code: In(dto.permissionCodes) } });
    }
    return await this.roleRepo.save(role);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Rol no encontrado.');
    if (dto.name !== undefined) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;
    return await this.roleRepo.save(role);
  }

  async deleteRole(id: string) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Rol no encontrado.');
    if (role.isSystem) throw new ConflictException('No se puede eliminar un rol del sistema.');
    const inUse = await this.userRepo.count({ where: { roleId: id } });
    if (inUse > 0) throw new ConflictException(`El rol está asignado a ${inUse} usuario(s); reasígnalos antes de eliminar.`);
    await this.roleRepo.remove(role);
    return { deleted: true };
  }

  async setRolePermissions(id: string, dto: SetRolePermissionsDto) {
    const role = await this.roleRepo.findOne({ where: { id }, relations: ['permissions'] });
    if (!role) throw new NotFoundException('Rol no encontrado.');
    role.permissions = dto.permissionCodes?.length
      ? await this.permRepo.find({ where: { code: In(dto.permissionCodes) } })
      : [];
    await this.roleRepo.save(role);
    return { roleId: id, permissionCodes: role.permissions.map((p) => p.code) };
  }

  /* ============ PERMISOS ESPECIALES POR USUARIO ============ */
  async getUserPermissions(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['roleEntity', 'roleEntity.permissions'] });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    const overrides = await this.userPermRepo.find({ where: { userId }, relations: ['permission'] });
    const rolePermissionCodes = (user.roleEntity?.permissions || []).map((p) => p.code);
    return {
      userId,
      roleKey: user.roleEntity?.key ?? user.role,
      rolePermissionCodes,
      overrides: overrides.map((o) => ({ code: o.permission?.code, effect: o.effect })),
      effective: await this.computeEffective(user, overrides),
    };
  }

  async setUserPermissions(userId: string, dto: SetUserPermissionsDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');

    // Reemplazo total de overrides del usuario.
    await this.userPermRepo.delete({ userId });
    const codes = (dto.overrides || []).map((o) => o.code);
    const perms = codes.length ? await this.permRepo.find({ where: { code: In(codes) } }) : [];
    const byCode = new Map(perms.map((p) => [p.code, p]));

    const rows: UserPermission[] = [];
    for (const o of dto.overrides || []) {
      const perm = byCode.get(o.code);
      if (perm) rows.push(this.userPermRepo.create({ userId, permissionId: perm.id, effect: o.effect }));
    }
    if (rows.length) await this.userPermRepo.save(rows);
    return this.getUserPermissions(userId);
  }

  /* ============ PERMISOS EFECTIVOS ============ */
  async getEffectivePermissions(userId: string): Promise<string[]> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['roleEntity', 'roleEntity.permissions'] });
    if (!user) return [];
    const overrides = await this.userPermRepo.find({ where: { userId }, relations: ['permission'] });
    return this.computeEffective(user, overrides);
  }

  private async computeEffective(user: User, overrides: UserPermission[]): Promise<string[]> {
    const set = new Set<string>((user.roleEntity?.permissions || []).map((p) => p.code));
    for (const o of overrides) {
      const code = o.permission?.code;
      if (!code) continue;
      if (o.effect === PermissionEffect.ALLOW) set.add(code);
      else set.delete(code);
    }
    return [...set];
  }
}
