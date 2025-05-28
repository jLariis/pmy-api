import { Injectable } from '@nestjs/common';

@Injectable()
export class BlacklistService {
    private readonly blacklistedTokens: Set<string> = new Set();

    add(token: string) {
        this.blacklistedTokens.add(token);
    }

    has(token: string): boolean {
        return this.blacklistedTokens.has(token);
    }
}