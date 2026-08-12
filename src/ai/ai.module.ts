import { Module } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

/** Módulo de integración con IA (DeepSeek). Reutilizable por otros features. */
@Module({
  providers: [DeepseekService],
  exports: [DeepseekService],
})
export class AiModule {}
