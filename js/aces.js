import { db } from './firebase-config.js?v=100';
import { getCourseDisplayName } from './courseData.js?v=100';
import { collection, getDocs, setDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Local cache to prevent re-fetching during the same session
let aceCache = null;
let aceSearchString = ''; // New state for filtering

export async function loadAcesPage() {
    const container = document.getElementById('aces-list-container');
    if (!container) return;

    // Initialize the search listener
    initAceFilters();

    // 1. Check if we already have the data in memory
    if (aceCache) {
        console.log("%c [Cache] Loading Aces from memory (0 reads)", "color: #10b981; font-weight: bold;");
        renderAces(aceCache);
        return;
    }

    try {
        console.log("%c [Firestore] Fetching Ace Bundles (1 read per course)", "color: #f59e0b; font-weight: bold;");
        const querySnapshot = await getDocs(collection(db, "ace_bundles"));
        
        const allData = [];
        querySnapshot.forEach(doc => {
            allData.push({
                courseName: doc.id,
                aces: doc.data().aces || []
            });
        });

        // 2. Save to cache and render
        aceCache = allData;
        renderAces(allData);

    } catch (error) {
        console.error("Error loading aces:", error);
        container.innerHTML = '<p class="error-text">Unable to load the Hall of Fame at this time.</p>';
    }
}

/**
 * Initialize Event Listeners
 */
function initAceFilters() {
    const searchInput = document.getElementById('ace-search');
    if (searchInput) {
        // Remove existing listener to prevent duplicates on nav switch
        searchInput.removeEventListener('input', handleAceSearch);
        searchInput.addEventListener('input', handleAceSearch);
    }
}

function handleAceSearch(e) {
    aceSearchString = e.target.value.toLowerCase();
    if (aceCache) {
        renderAces(aceCache);
    }
}

/**
 * Rendering Engine
 */
function renderAces(data) {
    const container = document.getElementById('aces-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<p style="opacity:0.5; text-align:center;">No aces found yet.</p>';
        return;
    }

    let hasAnyResults = false;

    // Sort course groups alphabetically
    const sortedGroups = [...data].sort((a, b) => getCourseDisplayName(a.courseName).localeCompare(getCourseDisplayName(b.courseName)));

    sortedGroups.forEach(group => {
        const courseName = getCourseDisplayName(group.courseName);

        // Filter individual aces within the course by player name OR course name
        const filteredAces = group.aces.filter(ace => {
            const matchesPlayer = ace.playerName.toLowerCase().includes(aceSearchString);
            const matchesCourse = courseName.toLowerCase().includes(aceSearchString);
            return matchesPlayer || matchesCourse;
        });

        // If no aces in this course match the search, don't render the course title at all
        if (filteredAces.length === 0) return;

        hasAnyResults = true;

        const courseDiv = document.createElement('div');
        courseDiv.className = 'course-group';
        
        // Sort individual filtered aces within the course by date (newest first)
        const sortedAces = filteredAces.sort((a, b) => new Date(b.date) - new Date(a.date));

courseDiv.innerHTML = `
        <h3 class="course-group-title">${courseName}</h3>
        <div class="ace-grid">
            ${sortedAces.map(ace => {
                // Restore the "Silver to Silver" or "Long to Short" logic
                const padInfo = (ace.pad && ace.basket) 
                    ? `${ace.pad} to ${ace.basket}` 
                    : (ace.pad || ace.basket || '');

                return `
                    <div class="ace-card">
                        <i class="ph ph-browser"></i>
                        <div class="contact-info">
                            <strong>${ace.playerName}</strong>
                            <div class="ace-details">
                                <span>
                                    Hole ${ace.hole} • ${ace.distance}ft 
                                    ${padInfo ? `• ${padInfo}` : ''} • ${new Date(ace.date).toLocaleDateString()}
                                </span>
                                <div class="ace-disc-tag">${ace.disc}</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    courseDiv.querySelectorAll('.ace-card').forEach(card => {
        card.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                card.classList.toggle('expanded');
            }
        });
    });

    container.appendChild(courseDiv);
    });

    // Final check if the search cleared out every single card
    if (!hasAnyResults) {
        container.innerHTML = `
            <div style="text-align:center; padding: 4rem; opacity: 0.4;">
                <p>No aces found for "${aceSearchString}"</p>
            </div>
        `;
    }
}














// TEMPORARY ADMIN SCRIPT - Corrected Flattened Structure
const uploadBylawsToFirestore = async () => {
    if (typeof db === 'undefined') {
        console.error("Database 'db' not found.");
        return;
    }

    const bylawsData = {
        "title": "BNDisc Club Bylaws",
        "lastModified": {
            "president": "Elijah Miller",
            "vicePresident": "Jake Eckert",
            "secretary": "Brad Ross",
            "treasurer": "Nicole Strine",
            "dateOfApproval": "2024-09-17"
        },
        "articles": [
            {
                "id": 1,
                "title": "Name and Purpose of the Club",
                "sections": [
                    { "label": "I", "text": "The name of our organization is the Bloomington Normal Disc Golf Club (BNDisc)." },
                    { 
                        "label": "II", 
                        "text": "The purpose of our club is to support and promote the sport of disc golf in Central Illinois by:",
                        "subPoints": [
                            "A: Serving as a liaison between the disc golf community and the Parks and Rec Departments in Bloomington/Normal",
                            "B: Volunteering time and labor to develop, maintain, and enhance disc golf courses in our area",
                            "C: Running leagues, tournaments, and other club events",
                            "D: Organizing and holding educational programs and fundraisers for worthy charities",
                            "E: Upholding high standards for all competitive disc golf events in accordance with PDGA policy",
                            "F: Promoting the efforts of club members to broaden awareness of disc golf in Central Illinois",
                            "G: Encouraging more players to get involved with our club and other disc golf activities",
                            "H: Setting examples of good sportsmanship and positive attitudes that inspire people to have fun playing disc golf"
                        ]
                    }
                ]
            },
            {
                "id": 2,
                "title": "Membership",
                "sections": [
                    { "label": "I", "text": "The success of our club depends on active participation of our members." },
                    { "label": "II", "text": "Active membership requires a fee of $25 per year." },
                    {
                        "label": "III",
                        "text": "Membership provides the following privileges:",
                        "subPoints": [
                            "A: Ability to nominate people for the BNDisc Board of Directors",
                            "B: Ability to vote on BNDisc Board Directors",
                            "C: Ability to hold a BNDisc Board Director position",
                            "D: Access to Board meeting minutes and treasury reports",
                            "E: Participation in member-only events",
                            "F: Bag tag, free entry into Bag Tag Challenge Tournament, and other perks",
                            "G: A number of additional perks documented on BNDisc.com"
                        ]
                    },
                    { "label": "IV", "text": "Memberships are annual and run from January 1 through December 31." },
                    { "label": "V", "text": "Membership may be revoked or suspended by the Board." },
                    { "label": "VI", "text": "Payment of the fee constitutes agreement to abide by these Bylaws." }
                ]
            },
            {
                "id": 3,
                "title": "Board of Directors",
                "sections": [
                    {
                        "label": "I",
                        "text": "The BNDisc Board of Directors is the governing body. It will consist of:",
                        "subPoints": [
                            "A: Four Officers: President, Vice President, Secretary, Treasurer",
                            "B: Trustees (minimum of 1, maximum of 5)"
                        ]
                    },
                    { "label": "II", "text": "All Board members will be nominated and elected in accordance with Article VI." },
                    { "label": "III", "text": "Board Members must maintain active membership." },
                    { "label": "IV", "text": "Vacancies will be replaced within 30 days." },
                    { "label": "V", "text": "The Board will meet monthly." },
                    { "label": "VI", "text": "A quorum (majority) is required for official business." },
                    { "label": "VII", "text": "Decisions are made by ballot majority vote." },
                    { "label": "VIII", "text": "Impeachment may be considered after 3 consecutive missed meetings." },
                    { "label": "IX", "text": "Removal requires a unanimous vote of the remaining Board." }
                ]
            },
            {
                "id": 4,
                "title": "Roles and Responsibilities",
                "sections": [
                    {
                        "label": "I",
                        "text": "President",
                        "subPoints": [
                            "A: Serve as the Chairman of the board",
                            "B: Set the agenda for all club meetings",
                            "C: Verify that a quorum is present at meetings in order for the Board to take action",
                            "D: Act as the tie-breaking vote if a majority is not reached",
                            "E: Ensure the club board and the club is operating in accordance with these Bylaws"
                        ]
                    },
                    {
                        "label": "II",
                        "text": "Vice President",
                        "subPoints": [
                            "A: Assist the President with functions of the Board",
                            "B: Assume the responsibilities of the President in the absence of the President"
                        ]
                    },
                    {
                        "label": "III",
                        "text": "Secretary",
                        "subPoints": [
                            "A: Keep record of the minutes of all Club and Board meetings",
                            "B: Present the meetings for approval and distribute them as appropriate"
                        ]
                    },
                    {
                        "label": "IV",
                        "text": "Treasurer",
                        "subPoints": [
                            "A: Maintain the financial records for the BNDisc Golf Club",
                            "B: Maintain all financial accounts in accordance with club policy",
                            "C: Collect all club funds and pay all the BNDisc club bills upon action by the Board",
                            "D: Report all finances via a Treasury Report at every meeting"
                        ]
                    },
                    {
                        "label": "V",
                        "text": "Trustees",
                        "subPoints": [
                            "A: Represent the general membership and act as a liaison between the members and the Board"
                        ]
                    }
                ]
            },
            {
                "id": 5,
                "title": "Committees",
                "sections": [
                    { "label": "I", "text": "Standing and temporary committees will be formed and or dissolved as warranted" },
                    { "label": "II", "text": "All committees will report to the Board" },
                    { "label": "III", "text": "Committee decisions and expenditures will require approval from the Board" },
                    { "label": "IV", "text": "Committee participation and meetings are open to all members" },
                    { "label": "V", "text": "Activities that might justify the formation of a committee include topics such as: community outreach, fundraising, club improvements, idea brainstorming, course development and maintenance, event planning, publicity, membership campaigns, etc" }
                ]
            },
            {
                "id": 6,
                "title": "Election Process",
                "sections": [
                    { "label": "I", "text": "The nomination process will be held for two weeks, starting on November 15th and running through November 30th." },
                    { "label": "II", "text": "Nominations for all positions will be accepted from any active member." },
                    { "label": "III", "text": "Any person nominated for more than one position will have to choose their preferred position before December 1st." },
                    { "label": "IV", "text": "Each nominee must accept or decline their nomination prior to December 1st." },
                    { "label": "V", "text": "Elections will take place during the month of December." },
                    { "label": "VI", "text": "In the event of a tie, the presiding Officer will cast the tie breaking vote." },
                    { "label": "VII", "text": "Newly elected Board members will be installed at the December or January Board meeting." },
                    {
                        "label": "VIII",
                        "text": "The term of office is two years, staggered in two groups, running from January 1 through December 31.",
                        "subPoints": [
                            "A: Group A’s term will start on even years, Group B will be on odd years.",
                            "B: Staggered terms will be split:",
                            "i: Group A: Vice President, Treasurer, Trustee A, and Trustee B.",
                            "ii: Group B: President, Secretary, Trustee C, Trustee D, and Trustee E.",
                            "C: If a board member from Group A runs, and wins, for a position in Group B, a special election will be held for the open position in Group A."
                        ]
                    },
                    { "label": "IX", "text": "No person may hold more than one position on the Board." },
                    { "label": "X", "text": "Special elections may be held at any time at the discretion of the Board to fill a vacancy." },
                    { "label": "XI", "text": "There is no limit to the number of terms an Officer may hold a position." },
                    { "label": "XII", "text": "Only a current board member can run for president." }
                ]
            },
            {
                "id": 7,
                "title": "Financial",
                "sections": [
                    { 
                        "label": "I", 
                        "text": "The fiscal year for BNDisc begins on January 1 and ends on December 31." 
                    },
                    { 
                        "label": "II", 
                        "text": "BNDisc is a volunteer organization. No fees, loans, reimbursements, donations, investments, or payments of any kind will be paid without Board approval." 
                    },
                    { 
                        "label": "III", 
                        "text": "A checking account will be maintained to pay all expenses. Any drafts on the account will require the signature of the Treasurer and one additional Officer." 
                    },
                    {
                        "label": "IV",
                        "text": "In the event that BNDisc is dissolved for any reason, all of its assets will be dispersed as follows:",
                        "subPoints": [
                            "A: All debts and claims will be paid from cash on hand.",
                            "B: Material assets will be sold if cash on hand is insufficient to pay all debts and claims.",
                            "C: Any remaining assets will be given to a local charity of the Board’s choosing."
                        ]
                    }
                ]
            },
            {
                "id": 8,
                "title": "Amending the ByLaws",
                "sections": [
                    { 
                        "label": "I", 
                        "text": "Amendments to these ByLaws may be submitted to the Board, in writing, by any active member." 
                    },
                    { 
                        "label": "II", 
                        "text": "The Board will consider all proposals and vote for approval or denial at the next Board meeting." 
                    },
                    { 
                        "label": "III", 
                        "text": "Proposed amendments require a 2/3 majority vote of present Board members in order to be approved." 
                    },
                    {
                        "label": "IV",
                        "text": "The Board will inform members of their decision as follows:",
                        "subPoints": [
                            "A: Approve the proposal as presented",
                            "B: Approve the proposal with suggested changes",
                            "C: Denial the proposal with reasons for opposition"
                        ]
                    },
                    { 
                        "label": "V", 
                        "text": "The ByLaws are ratified by a 2/3 majority vote of club members (of those who cast a vote and or are present at the annual BNDisc “All Hands” Club meeting). Members that are unable to attend may submit a vote by proxy through a board member prior to the meeting." 
                    },
                    { 
                        "label": "VI", 
                        "text": "Amendments are effective once they have been approved by the board, and ratified by the club." 
                    }
                ]
            },
            {
                "id": 9,
                "title": "Discipline of Members",
                "sections": [
                    { 
                        "label": "I", 
                        "text": "Disciplinary action against any member may be requested through a written petition signed by at least five active members." 
                    },
                    { 
                        "label": "II", 
                        "text": "The petition should be submitted to the board and should include a list of causes for the proposed discipline." 
                    },
                    { 
                        "label": "III", 
                        "text": "The Board will review any petitions and decide whether disciplinary action is warranted." 
                    },
                    { 
                        "label": "IV", 
                        "text": "If the Board decides that disciplinary action is warranted, a hearing date will be set. The petitioners and the accused will be notified and invited to attend. All parties will have equal opportunity to present their case." 
                    },
                    { 
                        "label": "V", 
                        "text": "If the Board decides that disciplinary action is not warranted, they will provide the reasons, in writing, for the non-action." 
                    },
                    { 
                        "label": "VI", 
                        "text": "The details of any disciplinary action (up to and including suspension and or removal from BNDisc) will be determined by the Board." 
                    },
                    { 
                        "label": "VII", 
                        "text": "The Board can suspend a member from the club for a specified amount of time, or permanently, by a 75% majority vote of the full Board. In this case, membership fees could be refunded at the discretion of the Board." 
                    }
                ]
            },
            {
                "id": 10,
                "title": "BNDisc Club Meetings",
                "sections": [
                    { 
                        "label": "I", 
                        "text": "All meetings of BNDisc will be conducted in accordance with Robert's Rules of Order, with the President acting as the Chair." 
                    },
                    { 
                        "label": "II", 
                        "text": "Board of Directors meetings will be held monthly. Future monthly meeting dates will be determined at the current Board meeting." 
                    },
                    { 
                        "label": "III", 
                        "text": "A quorum must be present to consider motions, and a majority of the quorum is required to pass all motions." 
                    },
                    { 
                        "label": "IV", 
                        "text": "Motions and resulting voting will be documented in the meeting minutes." 
                    },
                    { 
                        "label": "V", 
                        "text": "Active members, as well as guests (non-members), may petition the Board to attend a regularly scheduled Board meeting." 
                    },
                    { 
                        "label": "VI", 
                        "text": "The Board reserves the right to executive sessions when needed." 
                    },
                    { 
                        "label": "VII", 
                        "text": "BNDisc will hold an “All Hands” meeting for all club members at least once per year. Club members must be given at least three weeks notice prior to the meeting." 
                    },
                    { 
                        "label": "VIII", 
                        "text": "Club members are allowed to bring up any topic for the good and welfare of the club at each of the “All Hands” meetings." 
                    },
                    { 
                        "label": "IX", 
                        "text": "Votes at the 'All Hands' meetings are decided by a simple majority vote of attending active members, except Bylaws changes, which needs a 2/3 majority vote." 
                    }
                ]
            },
            {       
                "id": 11,
                "title": "Substance Abuse Policy",
                "sections": [
                    { 
                        "label": "I", 
                        "text": "Substance abuse is strictly prohibited at BN Disc Events." 
                    },
                    { 
                        "label": "II", 
                        "text": "Club members are encouraged to report any instances of substance abuse to a board member or the event director." 
                    },
                    {
                        "label": "III",
                        "text": "Upon receiving a report of substance abuse, the board will initiate the following actions against the offending player(s):",
                        "subPoints": [
                            "A: First Offense: The offending player(s) will receive a verbal warning",
                            "B: Second Offense: A 4-week suspension from all BN Disc events",
                            "C: Third Offense: A 1-year ban from all BN Disc events"
                        ]
                    },
                    {
                        "label": "IV",
                        "text": "After one year from the date of the ban, the offending player(s) may submit a reinstatement request to the board:",
                        "subPoints": [
                            "A: If reinstatement is approved, the player(s) will be placed on a probation for 1 year"
                        ]
                    },
                    { 
                        "label": "V", 
                        "text": "During the probationary period, any further violation of this policy by the player(s) will result in a permanent ban from all BN Disc events." 
                    }
                ]
            },
            {
                "id": 12,
                "title": "Conflict of Interest Policy",
                "sections": [
                    {
                        "label": "I",
                        "text": "At all times, Board Members should act in the best interests of the Bloomington Normal Disc Golf Club and remain impartial during board discussions.",
                        "subPoints": [
                            "A: If a board member has a conflict of interest, they will be required to abstain from any votes involving their conflict of interest"
                        ]
                    },
                    { 
                        "label": "II", 
                        "text": "Board Members must abide by the final decision of the board." 
                    },
                    {
                        "label": "III",
                        "text": "If a Board Member violates this policy, the rest of the board will meet separately to discuss next steps, which can include, but are not limited to;",
                        "subPoints": [
                            "A: A written warning to the board member",
                            "i: This includes a detailed account of the action(s) called into question, created by two officers and approved by the Board",
                            "B: Removal from the board, effective immediately",
                            "i: This includes a detailed account of the action(s) called into question, created by two officers and approved by the Board"
                        ]
                    }
                ]
            }
        ]
    };

    try {
        await setDoc(doc(db, "governance", "bylaws"), bylawsData);
        console.log("✅ SUCCESS: Flattened Bylaws uploaded!");
    } catch (error) {
        console.error("❌ ERROR:", error);
    }
};

//uploadBylawsToFirestore();