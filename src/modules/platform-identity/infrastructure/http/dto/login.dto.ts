import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@apreu.co' })
  @IsEmail({}, { message: 'Ingrese un correo válido.' })
  @MaxLength(150)
  email: string;

  @ApiProperty({ example: '********' })
  @IsString()
  @IsNotEmpty({ message: 'Ingrese su contraseña.' })
  @MaxLength(255)
  password: string;
}
