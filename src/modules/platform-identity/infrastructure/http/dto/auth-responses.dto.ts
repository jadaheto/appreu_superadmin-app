import { ApiProperty } from '@nestjs/swagger';

export class PlatformUserResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ['superadmin'] }) role: 'superadmin';
  @ApiProperty({ nullable: true, type: Date }) lastLogin: Date | null;
}

export class LoginResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty({ description: 'Vigencia del token en segundos' }) expiresIn: number;
  @ApiProperty({ type: PlatformUserResponseDto }) admin: PlatformUserResponseDto;
}
