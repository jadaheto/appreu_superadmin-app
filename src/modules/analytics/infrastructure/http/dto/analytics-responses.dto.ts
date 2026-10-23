import { ApiProperty } from '@nestjs/swagger';

export class MonthlyPointDto {
  @ApiProperty({ example: '2026-05' }) key: string;
  @ApiProperty({ example: 'may 2026' }) label: string;
  @ApiProperty() value: number;
}

export class CatalogTenantDto {
  @ApiProperty() id: number;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) adminEmail: string | null;
  @ApiProperty({ nullable: true, type: String }) adminPhone: string | null;
  @ApiProperty({ enum: ['active', 'suspended', 'trial'] }) status: string;
  @ApiProperty() tablesCreated: boolean;
  @ApiProperty() databaseName: string;
  @ApiProperty({ nullable: true, type: String }) trialEndsAt: string | null;
  @ApiProperty() publicUrl: string;
  @ApiProperty({ nullable: true, type: Date }) createdAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) updatedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) deletedAt: Date | null;
  @ApiProperty() isDeleted: boolean;
}

class TenantCountsDto {
  @ApiProperty() total: number;
  @ApiProperty() active: number;
  @ApiProperty() suspended: number;
  @ApiProperty() trial: number;
  @ApiProperty() deleted: number;
  @ApiProperty() databasesInstalled: number;
}

class UnreachableTenantDto {
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiProperty() reason: string;
}

class CoverageDto {
  @ApiProperty() queried: number;
  @ApiProperty() reachable: number;
  @ApiProperty({ type: [UnreachableTenantDto] }) unreachable: UnreachableTenantDto[];
}

class ActiveStudentsDto {
  @ApiProperty() active: number;
}

class RevenueDto {
  @ApiProperty({ description: 'Pagos aplicados del mes (COP)' }) thisMonth: number;
}

export class PlatformDashboardDto {
  @ApiProperty() generatedAt: Date;
  @ApiProperty({ type: TenantCountsDto }) tenants: TenantCountsDto;
  @ApiProperty({ type: ActiveStudentsDto }) students: ActiveStudentsDto;
  @ApiProperty({ type: RevenueDto }) revenue: RevenueDto;
  @ApiProperty({ type: [MonthlyPointDto] }) tenantsByMonth: MonthlyPointDto[];
  @ApiProperty({ type: [CatalogTenantDto] }) recentTenants: CatalogTenantDto[];
  @ApiProperty({ type: CoverageDto }) coverage: CoverageDto;
}

class TenantMetricsDto {
  @ApiProperty() activeStudents: number;
  @ApiProperty() totalStudents: number;
  @ApiProperty() revenueThisMonth: number;
  @ApiProperty() paymentsThisMonth: number;
  @ApiProperty() receivables: number;
  @ApiProperty() overdueReceivables: number;
  @ApiProperty() debtors: number;
}

class LatestPaymentDto {
  @ApiProperty() studentName: string;
  @ApiProperty() amount: number;
  @ApiProperty({ nullable: true, type: String }) method: string | null;
  @ApiProperty({ example: '2026-03-14 10:00:00' }) paidAt: string;
}

export class TenantAnalyticsDto {
  @ApiProperty({ type: CatalogTenantDto }) tenant: CatalogTenantDto;
  @ApiProperty() generatedAt: Date;
  @ApiProperty() available: boolean;
  @ApiProperty({ nullable: true, type: String }) unavailableReason: string | null;
  @ApiProperty({ type: TenantMetricsDto, nullable: true }) metrics: TenantMetricsDto | null;
  @ApiProperty({ type: [MonthlyPointDto] }) revenueLastSixMonths: MonthlyPointDto[];
  @ApiProperty({ type: [LatestPaymentDto] }) latestPayments: LatestPaymentDto[];
}
