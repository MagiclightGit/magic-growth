import { SourcesModule } from './modules/sources/sources.module.js';
import { BriefsModule } from './modules/briefs/briefs.module.js';
import { ResearchConversationsModule } from './modules/research-conversations/research-conversations.module.js';
import { CompetitorsModule } from './modules/competitors/competitors.module.js';
import { DramasModule } from './modules/dramas/dramas.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { ScoringModule } from './modules/scoring/scoring.module.js';
import { CandidatesModule } from './modules/candidates/candidates.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './platform/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { ProfileController } from './modules/health/profile.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { MembersController } from './modules/members/members.controller.js';
import { IntelligenceModule } from './modules/intelligence/intelligence.module.js';
import { ResearchModule } from './modules/research/research.module.js';
@Module({
  imports: [
    DatabaseModule,
    ProductsModule,
    CompetitorsModule,
    ResearchConversationsModule,
    DramasModule,
    AuthModule,
    IntelligenceModule,
    ResearchModule,
    CandidatesModule,
    TasksModule,
    ScoringModule,
    SourcesModule,
    BriefsModule,
  ],
  controllers: [HealthController, ProfileController, MembersController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
