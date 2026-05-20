import { Module } from '@nestjs/common';
import { WebSearchService } from './web-search.service';
import { WebSearchHistoryStore } from './web-search-history.store';
import { SearchController } from './search.controller';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [CredentialsModule],
  controllers: [SearchController],
  providers: [WebSearchService, WebSearchHistoryStore],
  exports: [WebSearchService, WebSearchHistoryStore],
})
export class SearchModule {}
