import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/infrastructure/http/decorators/public.decorator.js';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Verifica que la API esté en línea' })
  check() {
    return { status: 'ok', service: 'superadmin-api' };
  }
}
