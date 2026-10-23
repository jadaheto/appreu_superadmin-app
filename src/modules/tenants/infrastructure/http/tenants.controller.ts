import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActivateTenantUseCase,
  DeleteTenantUseCase,
  StartTenantTrialUseCase,
  SuspendTenantUseCase,
} from '../../application/change-tenant-status.use-cases.js';
import { CheckSlugAvailabilityUseCase } from '../../application/check-slug-availability.use-case.js';
import { CreateTenantUseCase } from '../../application/create-tenant.use-case.js';
import { GetTenantUseCase } from '../../application/get-tenant.use-case.js';
import { ListTenantsUseCase } from '../../application/list-tenants.use-case.js';
import { UpdateTenantUseCase } from '../../application/update-tenant.use-case.js';
import {
  CreateTenantDto,
  CreateTenantResponseDto,
  ListTenantsQueryDto,
  SlugAvailabilityQueryDto,
  SlugAvailabilityResponseDto,
  StartTrialDto,
  TenantPageResponseDto,
  TenantResponseDto,
  UpdateTenantDto,
} from './dto/tenant.dto.js';

/** School management (legacy `colegios.php` + `api/create_tenant.php`). Superadmin only. */
@ApiTags('Colegios')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly listTenants: ListTenantsUseCase,
    private readonly getTenant: GetTenantUseCase,
    private readonly checkSlug: CheckSlugAvailabilityUseCase,
    private readonly createTenant: CreateTenantUseCase,
    private readonly updateTenant: UpdateTenantUseCase,
    private readonly suspendTenant: SuspendTenantUseCase,
    private readonly activateTenant: ActivateTenantUseCase,
    private readonly startTrial: StartTenantTrialUseCase,
    private readonly deleteTenant: DeleteTenantUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista colegios con filtros (estado, búsqueda) y paginación',
  })
  @ApiOkResponse({ type: TenantPageResponseDto })
  list(@Query() query: ListTenantsQueryDto) {
    return this.listTenants.execute({
      criteria: {
        search: query.search,
        status: query.status,
        includeDeleted: query.includeDeleted ?? false,
      },
      page: query.toPageRequest(),
    });
  }

  @Get('slug-availability')
  @ApiOperation({
    summary: 'Verifica si un slug está disponible (formato, reservado, registrado, BD huérfana)',
  })
  @ApiOkResponse({ type: SlugAvailabilityResponseDto })
  slugAvailability(@Query() query: SlugAvailabilityQueryDto) {
    return this.checkSlug.execute(query.slug);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Aprovisiona un colegio: crea su BD, instala el esquema base, crea el director y lo registra',
    description: 'La contraseña temporal del director se devuelve una sola vez. Si un paso falla, se revierte la BD.',
  })
  @ApiCreatedResponse({ type: CreateTenantResponseDto })
  @ApiConflictResponse({ description: 'Slug registrado o BD existente' })
  create(@Body() dto: CreateTenantDto) {
    return this.createTenant.execute(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un colegio' })
  @ApiOkResponse({ type: TenantResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.getTenant.execute(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita nombre y contacto del director' })
  @ApiOkResponse({ type: TenantResponseDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTenantDto) {
    return this.updateTenant.execute({ id, ...dto });
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspende el colegio (apreu-api bloquea su acceso)',
  })
  @ApiOkResponse({ type: TenantResponseDto })
  suspend(@Param('id', ParseIntPipe) id: number) {
    return this.suspendTenant.execute({ id });
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactiva un colegio suspendido o convierte una prueba en activo',
  })
  @ApiOkResponse({ type: TenantResponseDto })
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.activateTenant.execute({ id });
  }

  @Post(':id/trial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pone el colegio en periodo de prueba' })
  @ApiOkResponse({ type: TenantResponseDto })
  trial(@Param('id', ParseIntPipe) id: number, @Body() dto: StartTrialDto) {
    return this.startTrial.execute({
      id,
      trialEndsAt: dto.trialEndsAt ?? null,
    });
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminación lógica: suspende y marca el colegio; conserva BD y slug',
  })
  @ApiOkResponse({ type: TenantResponseDto })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.deleteTenant.execute({ id });
  }
}
