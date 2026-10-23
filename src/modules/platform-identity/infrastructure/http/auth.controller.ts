import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import type { PlatformActor } from '../../../../shared/application/platform-actor.js';
import { CurrentActor } from '../../../../shared/infrastructure/http/decorators/current-actor.decorator.js';
import { Public } from '../../../../shared/infrastructure/http/decorators/public.decorator.js';
import { StrictThrottle } from '../../../../shared/infrastructure/http/throttling.js';
import { GetCurrentPlatformUserUseCase } from '../../application/get-current-platform-user.use-case.js';
import { LoginPlatformUserUseCase } from '../../application/login-platform-user.use-case.js';
import { LoginResponseDto, PlatformUserResponseDto } from './dto/auth-responses.dto.js';
import { LoginDto } from './dto/login.dto.js';

/** Authentication of platform operators (legacy `login.php` / `auth.php`). */
@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: LoginPlatformUserUseCase,
    private readonly currentUser: GetCurrentPlatformUserUseCase,
  ) {}

  @Public()
  @StrictThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia sesión de superadmin y devuelve un JWT de plataforma' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Demasiados intentos; espere antes de reintentar.' })
  signIn(@Body() dto: LoginDto) {
    return this.login.execute({ email: dto.email, password: dto.password });
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil del superadmin autenticado' })
  @ApiOkResponse({ type: PlatformUserResponseDto })
  me(@CurrentActor() actor: PlatformActor) {
    return this.currentUser.execute(actor.userId);
  }
}
