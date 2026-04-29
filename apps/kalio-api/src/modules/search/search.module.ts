import { Module } from '@nestjs/common';
import { WebSearchService } from './web-search.service';
import { SearchController } from './search.controller';

@Module({
  controllers: [SearchController],
  providers: [WebSearchService],
  exports: [WebSearchService],
})
export class SearchModule {}
