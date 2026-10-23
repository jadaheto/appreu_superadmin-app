import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPlatformDashboardUseCase } from '../../application/get-platform-dashboard.use-case.js';
import { GetTenantAnalyticsUseCase } from '../../application/get-tenant-analytics.use-case.js';
import { PlatformDashboardDto, TenantAnalyticsDto } from './dto/analytics-responses.dto.js';

/** Platform analytics (legacy `dashboard.php` and `analytics.php`). */
@ApiTags('Analítica')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(
    private readonly dashboard: GetPlatformDashboardUseCase,
    private readonly tenantAnalytics: GetTenantAnalyticsUseCase,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'KPIs globales, altas por mes, colegios recientes y cobertura de la consulta' })
  @ApiOkResponse({ type: PlatformDashboardDto })
  getDashboard() {
    return this.dashboard.execute();
  }

  @Get('tenants/:id/analytics')
  @ApiOperation({ summary: 'Métricas de un colegio (alumnos, ingresos, cartera, deudores, últimos pagos)' })
  @ApiOkResponse({ type: TenantAnalyticsDto })
  getTenantAnalytics(@Param('id', ParseIntPipe) id: number) {
    return this.tenantAnalytics.execute(id);
  }
}
