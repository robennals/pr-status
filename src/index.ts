#!/usr/bin/env node

import { execSync } from 'child_process';

import chalk from 'chalk';

interface Author {
    login: string;
}

interface Review {
    author: Author;
    authorAssociation: string;
    state: string;
    submittedAt: string;
    body: string;
}

interface ReviewRequest {
    __typename: string;
    login?: string;
    slug?: string;
    name?: string;
}

interface Comment {
    author: Author;
    createdAt: string;
}

interface ReviewComment {
    user: Author;
    created_at: string;
}

interface StatusCheck {
    conclusion: string;
    status: string;
}

interface PullRequest {
    number: number;
    title: string;
    reviews: Review[];
    reviewRequests: ReviewRequest[];
    comments: Comment[];
    updatedAt: string;
    createdAt: string;
    reviewDecision: string;
    url: string;
    statusCheckRollup: StatusCheck[];
}

type PRStatus = 'checks-failing' | 'open-comment' | 'prod' | 're-request' | 'merge' | 'request' | 'approved';

interface PRStatusInfo {
    status: PRStatus;
    reviewer?: string;
    details?: string;
}

function executeGhCommand(command: string): string {
    return execSync(command, { encoding: 'utf-8' });
}

function getTerminalWidth(): number {
    return process.stdout.columns || 80;
}

function getCurrentUser(): string {
    const result = executeGhCommand("gh api graphql -f query='{ viewer { login } }'");
    return JSON.parse(result).data.viewer.login;
}

function getOpenPRs(username: string): PullRequest[] {
    const result = executeGhCommand(
        `gh pr list --author ${username} --json number,title,reviewRequests,reviews,comments,updatedAt,createdAt,reviewDecision,url,statusCheckRollup --limit 100`,
    );
    return JSON.parse(result);
}

function getReviewerName(reviewRequest: ReviewRequest): string {
    if (reviewRequest.__typename === 'User') {
        return reviewRequest.login || 'unknown';
    } else if (reviewRequest.__typename === 'Team') {
        return `@${reviewRequest.slug || reviewRequest.name || 'team'}`;
    }
    return 'unknown';
}

function isBot(login: string): boolean {
    const botPatterns = ['bot', 'github-actions', 'codex', 'dependabot'];
    return botPatterns.some((pattern) => login.toLowerCase().includes(pattern));
}

function getBusinessHoursBetween(startDate: Date, endDate: Date): number {
    let businessHours = 0;
    const current = new Date(startDate);

    while (current < endDate) {
        const dayOfWeek = current.getDay();
        // 0 = Sunday, 6 = Saturday
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            // It's a weekday, count the hours
            const nextDay = new Date(current);
            nextDay.setDate(nextDay.getDate() + 1);
            nextDay.setHours(0, 0, 0, 0);

            const hoursToAdd = Math.min(
                (nextDay.getTime() - current.getTime()) / (60 * 60 * 1000),
                (endDate.getTime() - current.getTime()) / (60 * 60 * 1000),
            );
            businessHours += hoursToAdd;
        }

        // Move to next day
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
    }

    return businessHours;
}

function analyzePRStatus(pr: PullRequest, currentUser: string): PRStatusInfo {
    // Check for failing CI checks first (highest priority)
    const failingChecks = pr.statusCheckRollup?.filter((check) => check.status === 'COMPLETED' && check.conclusion === 'FAILURE');
    if (failingChecks && failingChecks.length > 0) {
        return {
            status: 'checks-failing',
            details: `${failingChecks.length} check(s) failing`,
        };
    }

    // Filter out bot reviews and comments
    const humanReviews = pr.reviews.filter((r) => !isBot(r.author.login));
    const humanComments = pr.comments.filter((c) => !isBot(c.author.login));

    // Check if there are any requested reviewers (including teams)
    const requestedReviewers = pr.reviewRequests;

    // If no one has been asked to review
    if (requestedReviewers.length === 0 && humanReviews.length === 0) {
        return { status: 'request', details: 'No reviewers requested' };
    }

    // Find all change requests where I don't have the last word
    const unrepliedChangeRequests = humanReviews
        .filter((r) => r.state === 'CHANGES_REQUESTED' && r.author.login !== currentUser)
        .filter((r) => {
            const reviewTime = new Date(r.submittedAt).getTime();
            const reviewerLogin = r.author.login;

            // Find my latest activity (comment or review) after this change request
            const myCommentsAfter = humanComments
                .filter((c) => c.author.login === currentUser && new Date(c.createdAt).getTime() > reviewTime)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            const myReviewsAfter = humanReviews
                .filter((rev) => rev.author.login === currentUser && new Date(rev.submittedAt).getTime() > reviewTime)
                .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

            const myLastActivityTime = Math.max(
                myCommentsAfter.length > 0 ? new Date(myCommentsAfter[0].createdAt).getTime() : 0,
                myReviewsAfter.length > 0 ? new Date(myReviewsAfter[0].submittedAt).getTime() : 0,
            );

            // If I haven't replied at all, this is unreplied
            if (myLastActivityTime === 0) {
                return true;
            }

            // Check if the reviewer has commented or reviewed after my last activity
            // But exclude APPROVED reviews (those resolve the change request)
            const theirActivityAfterMe =
                humanComments.some((c) => c.author.login === reviewerLogin && new Date(c.createdAt).getTime() > myLastActivityTime) ||
                humanReviews.some(
                    (rev) =>
                        rev.author.login === reviewerLogin &&
                        rev.state !== 'APPROVED' &&
                        new Date(rev.submittedAt).getTime() > myLastActivityTime,
                );

            return theirActivityAfterMe;
        });

    // Find all comments where I haven't responded
    const unrepliedComments = humanReviews
        .filter((r) => r.state === 'COMMENTED' && r.author.login !== currentUser)
        .filter((r) => {
            const reviewTime = new Date(r.submittedAt).getTime();

            // For any comment, check if I've had any activity (comments or reviews) since then
            const myCommentsAfter = humanComments.some(
                (c) => c.author.login === currentUser && new Date(c.createdAt).getTime() > reviewTime,
            );
            const myReviewsAfter = humanReviews.some(
                (rev) => rev.author.login === currentUser && new Date(rev.submittedAt).getTime() > reviewTime,
            );
            return !myCommentsAfter && !myReviewsAfter;
        });

    // Prioritize unreplied change requests
    if (unrepliedChangeRequests.length > 0) {
        const latest = unrepliedChangeRequests.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];
        let commentPreview = '';
        if (latest.body) {
            const body = latest.body.trim();
            const maxCommentWidth = getTerminalWidth() - 35;
            const firstLine = body.split('\n')[0].substring(0, maxCommentWidth);
            commentPreview = ` - "${firstLine}${body.split('\n')[0].length > maxCommentWidth ? '...' : ''}"`;
        }

        const reviewers = [...new Set(unrepliedChangeRequests.map((r) => r.author.login))];
        return {
            status: 'open-comment',
            reviewer: reviewers.join(', '),
            details: `Changes requested${commentPreview}`,
        };
    }

    // Then check for unreplied comments
    if (unrepliedComments.length > 0) {
        const reviewers = [...new Set(unrepliedComments.map((r) => r.author.login))];

        // Try to find a comment with a body to show as preview
        const latestWithBody = unrepliedComments
            .filter((r) => r.body)
            .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];

        let commentPreview = '';
        if (latestWithBody?.body) {
            const body = latestWithBody.body.trim();
            const maxCommentWidth = getTerminalWidth() - 40;
            const firstLine = body.split('\n')[0].substring(0, maxCommentWidth);
            commentPreview = ` - "${firstLine}${body.split('\n')[0].length > maxCommentWidth ? '...' : ''}"`;
        }

        return {
            status: 'open-comment',
            reviewer: reviewers.join(', '),
            details: `Comments but no approval${commentPreview}`,
        };
    }

    // Check if there are reviewers I've responded to but haven't re-requested
    // Exclude reviewers who have already approved (they're done)
    const requestedLogins = pr.reviewRequests.map((rr) => getReviewerName(rr));
    const approvedReviewers = new Set(humanReviews.filter((r) => r.state === 'APPROVED').map((r) => r.author.login));

    const reviewersNeedingReRequest = humanReviews
        .filter((r) => (r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED') && r.author.login !== currentUser)
        .filter((r) => !approvedReviewers.has(r.author.login)) // Skip if they've approved
        .filter((r) => {
            const reviewTime = new Date(r.submittedAt).getTime();
            const myActivityAfter =
                humanReviews.some((rev) => rev.author.login === currentUser && new Date(rev.submittedAt).getTime() > reviewTime) ||
                humanComments.some((c) => c.author.login === currentUser && new Date(c.createdAt).getTime() > reviewTime);
            return myActivityAfter && !requestedLogins.includes(r.author.login);
        })
        .map((r) => r.author.login);

    const uniqueReviewersNeedingReRequest = [...new Set(reviewersNeedingReRequest)];
    if (uniqueReviewersNeedingReRequest.length > 0) {
        return {
            status: 're-request',
            reviewer: uniqueReviewersNeedingReRequest.join(', '),
            details: 'Replied to comments, need to re-request review',
        };
    }

    // Check if there are any reviewers still requested who haven't responded
    if (requestedReviewers.length > 0) {
        const requestedLogins = requestedReviewers.map((rr) => getReviewerName(rr));

        // Check if it's been more than 48 business hours since last PR update
        const now = new Date();
        const lastUpdate = new Date(pr.updatedAt);
        const businessHours = getBusinessHoursBetween(lastUpdate, now);
        const prodThresholdHours = 48;

        if (businessHours > prodThresholdHours) {
            const businessDays = Math.floor(businessHours / 24);
            return {
                status: 'prod',
                reviewer: requestedLogins.join(', '),
                details: `No response for ${businessDays} business day(s)`,
            };
        } else {
            return {
                status: 'approved',
                reviewer: requestedLogins.join(', '),
                details: 'Waiting for review (< 48 business hours)',
            };
        }
    }

    // Check if everyone has approved
    const approvals = humanReviews.filter((r) => r.state === 'APPROVED' && r.author.login !== currentUser);
    if (approvals.length > 0) {
        const approvers = [...new Set(approvals.map((r) => r.author.login))];
        return {
            status: 'merge',
            details: `Approved by ${approvers.join(', ')}`,
        };
    }

    return { status: 'approved', details: 'Unknown state' };
}

function getStatusColor(status: PRStatus): (text: string) => string {
    switch (status) {
        case 'checks-failing':
            return chalk.red.bold;
        case 'open-comment':
            return chalk.red.bold;
        case 're-request':
            return chalk.yellow.bold;
        case 'prod':
            return chalk.magenta.bold;
        case 'merge':
            return chalk.green.bold;
        case 'request':
            return chalk.cyan.bold;
        case 'approved':
            return chalk.blue;
    }
}

function getStatusLabel(status: PRStatus): string {
    switch (status) {
        case 'checks-failing':
            return '❌ CHECKS FAILING';
        case 'open-comment':
            return '💬 OPEN COMMENT';
        case 're-request':
            return '🔄 RE-REQUEST';
        case 'prod':
            return '⏰ PROD';
        case 'merge':
            return '✅ MERGE';
        case 'request':
            return '👀 REQUEST';
        case 'approved':
            return '⏳ WAITING';
    }
}

function main() {
    console.log(chalk.bold('\n📋 PR Status Summary\n'));

    const currentUser = getCurrentUser();
    console.log(chalk.dim(`Checking PRs for: ${currentUser}\n`));

    const prs = getOpenPRs(currentUser);

    if (prs.length === 0) {
        console.log(chalk.yellow('No open PRs found.'));
        return;
    }

    // Group PRs by status
    const prsByStatus = new Map<PRStatus, Array<{ pr: PullRequest; info: PRStatusInfo }>>();

    for (const pr of prs) {
        const info = analyzePRStatus(pr, currentUser);
        const group = prsByStatus.get(info.status) || [];
        group.push({ pr, info });
        prsByStatus.set(info.status, group);
    }

    // Print PRs by priority
    const statusOrder: PRStatus[] = ['checks-failing', 'open-comment', 're-request', 'merge', 'prod', 'request', 'approved'];

    for (const status of statusOrder) {
        const group = prsByStatus.get(status);
        if (!group || group.length === 0) continue;

        const colorFn = getStatusColor(status);
        console.log(colorFn(`${getStatusLabel(status)}:`));

        for (const { pr, info } of group) {
            const title = pr.title.length > 60 ? pr.title.substring(0, 57) + '...' : pr.title;
            console.log(`  ${chalk.dim(`#${pr.number}`)} ${title}`);
            console.log(`    ${chalk.dim('→')} ${chalk.cyan.underline(pr.url)}`);

            if (info.reviewer) {
                console.log(`    ${chalk.dim('→')} Reviewer: ${chalk.bold(info.reviewer)}`);
            }
            if (info.details) {
                console.log(`    ${chalk.dim('→')} ${info.details}`);
            }
            console.log();
        }
    }

    console.log(chalk.dim(`\nTotal: ${prs.length} open PR(s)\n`));
}

main();
