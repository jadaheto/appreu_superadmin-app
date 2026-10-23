import { Logger } from '@nestjs/common';

// Keep the test output clean: application logs are asserted through behaviour, not stdout.
Logger.overrideLogger(false);
