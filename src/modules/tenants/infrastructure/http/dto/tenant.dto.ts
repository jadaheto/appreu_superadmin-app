import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../../shared/infrastructure/http/dto/pagination-query.dto.js';
import { TENANT_STATUSES, type TenantStatus } from '../../../domain/tenant-status.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ListTenantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;

  @ApiPropertyOptional({
    default: false,
    description: 'Incluir colegios eliminados lógicamente',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeDeleted?: boolean;
}

export class SlugAvailabilityQueryDto {
  @ApiProperty({ example: 'colegio-norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  slug: string;
}

export class CreateTenantDto {
  @ApiProperty({
    example: 'colegio-norte',
    description: 'Minúsculas, números y guiones; 3–60 caracteres',
  })
  @IsString()
  @IsNotEmpty({ message: 'El slug es obligatorio.' })
  @MaxLength(60)
  slug: string;

  @ApiProperty({ example: 'IE Colegio Norte' })
  @IsString()
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres.' })
  @MaxLength(200)
  name: string;

  @ApiProperty({
    example: 'director@colegionorte.edu.co',
    description: 'Correo del director (usuario admin)',
  })
  @IsEmail({}, { message: 'Ingrese un correo válido.' })
  @MaxLength(150)
  adminEmail: string;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  adminPhone?: string;

  @ApiPropertyOptional({ enum: ['active', 'trial'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'trial'])
  initialStatus?: 'active' | 'trial';

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Fin del periodo de prueba (AAAA-MM-DD)',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Use el formato AAAA-MM-DD.' })
  trialEndsAt?: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'Ingrese un correo válido.' })
  @MaxLength(150)
  adminEmail?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(30)
  adminPhone?: string | null;
}

export class StartTrialDto {
  @ApiPropertyOptional({ example: '2026-12-31', nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_PATTERN, { message: 'Use el formato AAAA-MM-DD.' })
  trialEndsAt?: string | null;
}

export class TenantResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) adminEmail: string | null;
  @ApiProperty({ nullable: true, type: String }) adminPhone: string | null;
  @ApiProperty({ enum: TENANT_STATUSES }) status: TenantStatus;
  @ApiProperty() tablesCreated: boolean;
  @ApiProperty() databaseName: string;
  @ApiProperty({ nullable: true, type: String }) trialEndsAt: string | null;
  @ApiProperty() publicUrl: string;
  @ApiProperty({ nullable: true, type: Date }) createdAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) updatedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) deletedAt: Date | null;
  @ApiProperty() isDeleted: boolean;
}

export class TenantPageResponseDto {
  @ApiProperty({ type: [TenantResponseDto] }) items: TenantResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class SlugAvailabilityResponseDto {
  @ApiProperty() slug: string;
  @ApiProperty() available: boolean;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ nullable: true, type: String }) databaseName: string | null;
}

export class DirectorCredentialsDto {
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({
    description: 'Contraseña temporal; se devuelve una sola vez y no se almacena en claro',
  })
  temporaryPassword: string;
}

export class CreateTenantResponseDto {
  @ApiProperty({ type: TenantResponseDto }) tenant: TenantResponseDto;
  @ApiProperty({ type: DirectorCredentialsDto })
  director: DirectorCredentialsDto;
  @ApiProperty({ type: [String] }) warnings: string[];
}
