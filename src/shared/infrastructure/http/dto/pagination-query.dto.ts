import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { PageRequest } from '../../../domain/pagination.js';

/** Common `?page=&limit=&search=` query string for list endpoints. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Texto libre de búsqueda' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  toPageRequest(): PageRequest {
    return { page: this.page, limit: this.limit };
  }
}
