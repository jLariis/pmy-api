import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { NoAudit } from 'src/audit/audit.decorator';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { getSupportAgents } from './support-agents';

const uploadRoot = path.join(process.cwd(), 'uploads', 'support');

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
@NoAudit()
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Get('agents')
  agents() { return getSupportAgents().map(({ id, nombre, email }) => ({ id, nombre, email })); }

  @Get('tickets')
  list(@Query('estado') estado?: string, @Query('tipo') tipo?: string, @Query('q') q?: string) {
    return this.service.list({ estado, tipo, q }).then((tickets) => ({ tickets }));
  }

  @Get('tickets/mine')
  mine(@Req() req: any) {
    return this.service.listMine(req.user.userId).then((tickets) => ({ tickets }));
  }

  @Get('tickets/:id')
  getOne(@Param('id') id: string) { return this.service.getOne(id); }

  @Post('tickets')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('imagenes', 8, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(uploadRoot, (req as any).__ticketDir ?? ((req as any).__ticketDir = randomUUID()));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
      file.mimetype.startsWith('image/') ? cb(null, true) : cb(new BadRequestException('Solo imágenes'), false),
  }))
  create(@Body() dto: CreateTicketDto, @UploadedFiles() files: Express.Multer.File[], @Req() req: any) {
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 300);
    return this.service.create({ ...dto, userAgent } as any, req.user, files);
  }

  @Patch('tickets/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Req() req: any) {
    return this.service.update(id, dto, req.user);
  }

  @Post('tickets/:id/comments')
  addComment(@Param('id') id: string, @Body() dto: AddCommentDto, @Req() req: any) {
    return this.service.addComment(id, dto, req.user);
  }
}
