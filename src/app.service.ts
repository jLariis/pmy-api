import { Get, Injectable } from '@nestjs/common';

@Injectable()
export class AppService {

  @Get()
  getHealth() {
    return { status: 'ok' };
  }
}
