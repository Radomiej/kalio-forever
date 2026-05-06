import { Module } from '@nestjs/common';
import { WebSearchService } from './web-search.service';
import { SearchController } from './search.controller';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [CredentialsModule],
  controllers: [SearchController],
  providers: [WebSearchService],
  exports: [WebSearchService],
})
export class SearchModule {}
