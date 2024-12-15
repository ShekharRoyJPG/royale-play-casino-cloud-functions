const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true }); // Enable CORS for all origins

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();
// const PASSKEY = functions.config().auth.passkey;

// Health Check endpoint
exports.healthCheck = functions.https.onRequest((req, res) => {
  res.status(200).send("OK");
});

exports.saveBankDetails = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        try {
            // Validate request method
            if (req.method !== "POST") {
                return res.status(405).send({ error: "Method not allowed. Use POST." });
            }

            const { uid, bankDetails } = req.body;

            // Validate required parameters
            if (!uid || !bankDetails) {
                return res
                    .status(400)
                    .send({ error: "Both uid and bankDetails are required." });
            }

            // Save or update bank details in Firestore
            await db.collection("admin").doc(uid).set({ bankDetails }, { merge: true });

            return res.status(200).send({
                success: true,
                message: "Bank details updated successfully!",
            });
        } catch (error) {
            console.error("Error saving bank details:", error);
            return res.status(500).send({
                error: "Failed to save bank details. Please try again.",
            });
        }
    });
});

exports.deleteStaff = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
    // Check the request method
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }
  
    // Parse the request body
    const { currentUserId, staffId } = req.body;
  
    if (!currentUserId || !staffId) {
      return res.status(400).send('Both currentUserId and staffId must be provided.');
    }
  
    // Check if the current user is trying to delete themselves
    if (currentUserId === staffId) {
      return res.status(403).send('You cannot delete yourself.');
    }
  
    try {
         // Check if the staff being deleted has a role of 'superadmin'
        const staffDoc = await db.collection('admin').doc(staffId).get();
        
        if (!staffDoc.exists) {
            return res.status(404).send('Staff member not found.');
        }

        const staffData = staffDoc.data();

        if (staffData.role === 'superadmin') {
            return res.status(403).send('You cannot delete a superadmin.');
        }
        // Delete user from Firebase Authentication
        await admin.auth().deleteUser(staffId);
    
        // Delete the staff member from Firestore
        await db.collection('admin').doc(staffId).delete();
    
        // Send success response
        return res.status(200).send({ message: 'Staff member deleted successfully!' });
    } catch (err) {
      console.error('Error deleting staff:', err);
      return res.status(500).send('Failed to delete staff.');
    }
})
  });

exports.getAllUsers = functions.https.onRequest(async (req, res) => {

    cors(req, res, async () => {
        // Check the request method
        if (req.method !== 'GET') {
          return res.status(405).send('Method Not Allowed');
        }
        try {
            // Reference to the 'users' collection
            const usersSnapshot = await db.collection('users').get();

            // Extract user data from the snapshot
            const usersData = usersSnapshot.docs.map(doc => {
                const {password,balanceHistory, ...userData}=doc.data()
                return {
                    id: doc.id, // Document ID
                    ...userData, // Spread the document data
                }
            });

            return res.status(200).json({ 
            success: true, 
            data: usersData 
            });
        } catch (error) {
            console.error('Error fetching users:', error);
            return res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve users', 
            error: error.message 
            });
        }
    })
});

exports.submitBalanceRequest = functions.https.onRequest(async (req, res) => {
    try {
      // Get the request body
      const { userId, amount, phoneNumber, mode, txnId } = req.body;
  
      // Validate inputs
      if (!userId || !amount || !phoneNumber || !txnId || !mode ) {
        return res.status(400).send({ error: 'Missing required fields' });
      }

      // Check for minimum deposit of 100 rupees
    if (parseFloat(amount) < 100) {
        return res.status(400).send({ error: 'Minimum deposit is 100 rupees' });
      }
  
      // Get the current timestamp
      const requestedAt = admin.firestore.Timestamp.now();
  
      // Create the balance request object
      const balanceRequest = {
        type: 'deposit',
        amount: parseFloat(amount),
        phoneNumber,
        mode,
        txnId,
        verified: false,
        requestedAt,
      };
  
      // Reference to the user document in Firestore
      const userDocRef = db.collection('users').doc(userId);
  
      // Update the user's balance history with the new request
      await userDocRef.set(
        {
          balanceHistory: admin.firestore.FieldValue.arrayUnion(balanceRequest),
        },
        { merge: true }
      );
  
      // Return a success response
      return res.status(200).send({ message: 'Balance request added successfully.' });
    } catch (error) {
      console.error('Error submitting balance request:', error);
      return res.status(500).send({ error: 'Failed to request balance' });
    }
  });


exports.submitWithdrawRequest = functions.https.onRequest(async (req, res) => {
try {
    // Get the request body
    const { userId, amount, phoneNumber, mode, txnId } = req.body;

    // Validate inputs
    if (!userId || !amount ) {
    return res.status(400).send({ error: 'Missing required fields' });
    }

    // Convert the amount to a float for comparison
    const withdrawalAmount = parseFloat(amount);

    // Check for minimum withdrawal of 300
    if (withdrawalAmount < 300) {
    return res.status(400).send({ error: 'Minimum withdrawal is 300' });
    }

    // Reference to the user document in Firestore
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    // Check if the user exists
    if (!userDoc.exists) {
    return res.status(404).send({ error: 'User not found' });
    }

    // Get the current balance from the user document
    const currentBalance = userDoc.data().balance || 0;

    // Check if the withdrawal amount is greater than the current balance
    if (withdrawalAmount > currentBalance) {
    return res.status(400).send({ error: 'Insufficient balance for withdrawal' });
    }


    // Get the current time in IST (UTC +5:30)
    const now = new Date();
    const IST_OFFSET = 5.5 * 60; // IST is UTC +5:30 (in minutes)
    const IST = new Date(now.getTime() + IST_OFFSET * 60000); // Convert to IST time

    const currentDay = IST.getDay(); // Sunday = 0, Monday = 1, ..., Saturday = 6
    const currentTime = IST.getHours() * 60 + IST.getMinutes(); // current time in minutes

    // Define the allowed withdrawal times
    const isAllowedWithdrawalTime = (currentDay >= 1 && currentDay <= 6 && currentTime >= 660 && currentTime <= 180) || // Monday to Saturday, 11 AM to 3 AM
      (currentDay === 0 && currentTime >= 660 && currentTime <= 120); // Sunday, 11 AM to 2 PM

    // Check if the current time is within the allowed withdrawal period
    // if (!isAllowedWithdrawalTime) {
    //   return res.status(400).send({ error: 'Withdrawals are not allowed at this time' });
    // }

    // Check if the current time is within the allowed withdrawal period
    if (!isAllowedWithdrawalTime) {
        const allowedTimeMessage = currentDay === 0 ?
            'Withdrawals are allowed only on Sunday between 11 AM and 2 PM IST.' :
            'Withdrawals are allowed only from Monday to Saturday between 11 AM and 3 AM IST.';
            
        return res.status(200).send({ message: `Withdrawals are not allowed at this time. ${allowedTimeMessage}` });
        }

    // Get the current timestamp
    const requestedAt = admin.firestore.Timestamp.now();

    // Create the withdraw request object
    const withdrawRequest = {
    type: 'withdraw',
    amount: withdrawalAmount,
    phoneNumber,
    mode,
    txnId,
    verified: false,
    requestedAt,
    };

    // Update the user's balance history with the new withdraw request
    await userDocRef.set(
    {
        balanceHistory: admin.firestore.FieldValue.arrayUnion(withdrawRequest),
    },
    { merge: true }
    );

    // Return a success response
    return res.status(200).send({ message: 'Withdraw request added successfully.' });
} catch (error) {
    console.error('Error submitting withdraw request:', error);
    return res.status(500).send({ error: 'Failed to request withdraw' });
}
});


exports.verifyDeposit = functions.https.onRequest((req, res) => {
    // Enable CORS first
    cors(req, res, async () => {
        const { userId, amount, requestedAt: depositRequestedAt } = req.body; // Assuming the data is sent via a POST request

        try {
            const userRef = db.collection("users").doc(userId);

            // Use Firestore transaction to ensure atomic update of balance and balanceHistory
            await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);

                if (!userDoc.exists) {
                    throw new Error("User not found");
                }

                const userData = userDoc.data();

                // Find the deposit entry in the balance history
                const historyToVerify = userData.balanceHistory.find(
                    (history) =>
                        history.requestedAt.seconds === depositRequestedAt.seconds &&
                        history.requestedAt.nanoseconds === depositRequestedAt.nanoseconds &&
                        history.type === 'deposit' && // Ensure it's a deposit request
                        !history.verified // Ensure it's unverified
                );

                if (!historyToVerify) {
                    throw new Error("Balance history entry not found or already verified");
                }

                // Update balance
                transaction.update(userRef, {
                    balance: admin.firestore.FieldValue.increment(amount)
                });

                const verifiedAt = admin.firestore.Timestamp.now();

                // Update balance history
                const updatedBalanceHistory = userData.balanceHistory.map((history) =>
                    history.requestedAt.seconds === depositRequestedAt.seconds &&
                    history.requestedAt.nanoseconds === depositRequestedAt.nanoseconds
                        ? { ...history, verifiedAt, verified: true }
                        : history
                );

                transaction.update(userRef, {
                    balanceHistory: updatedBalanceHistory
                });
            });

            return res.status(200).send({ message: "Deposit verified and balance added successfully" });
        } catch (error) {
            console.error("Error verifying deposit:", error);
            return res.status(500).send({ error: error.message });
        }
    });
});



exports.verifyWithdrawal = functions.https.onRequest((req, res) => {
// Enable CORS first
cors(req, res, async () => {
    const { userId, amount, txnId, requestedAt: withdrawRequestedAt } = req.body; // Assuming the data is sent via a POST request

    try {
        const userRef = db.collection("users").doc(userId);
        
        // Use a Firestore transaction to ensure atomicity
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                throw new Error("User not found");
            }

            const userData = userDoc.data();

            // Find the withdrawal history entry that matches the requested timestamp
            const historyToVerify = userData.balanceHistory.find(
                (history) =>
                    history.requestedAt.seconds === withdrawRequestedAt.seconds &&
                    history.requestedAt.nanoseconds === withdrawRequestedAt.nanoseconds &&
                    history.type === 'withdraw' && // Ensure it's a withdraw request
                    !history.verified // Ensure it's unverified
            );

            if (!historyToVerify) {
                throw new Error("Withdrawal history entry not found or already verified");
            }

            // Ensure the withdrawal amount doesn't exceed the user's balance
            if (userData.balance < amount) {
                throw new Error("Insufficient balance for withdrawal");
            }

            // Deduct the amount from the user's balance
            transaction.update(userRef, {
                balance: admin.firestore.FieldValue.increment(-amount)
            });

            const verifiedAt = admin.firestore.Timestamp.now();

            // Update the balance history to mark the withdrawal as verified
            const updatedBalanceHistory = userData.balanceHistory.map((history) =>
                history.requestedAt.seconds === withdrawRequestedAt.seconds &&
                history.requestedAt.nanoseconds === withdrawRequestedAt.nanoseconds
                    ? { ...history, verifiedAt, verified: true, txnId: txnId }
                    : history
            );

            transaction.update(userRef, {
                balanceHistory: updatedBalanceHistory
            });
        });

        return res.status(200).send({ message: "Withdrawal verified and balance deducted successfully" });
    } catch (error) {
        console.error("Error verifying withdrawal:", error);
        return res.status(500).send({ error: error.message });
    }
});
});



exports.addBet = functions.https.onRequest(async (req, res) => {
    try {
      // Parse and validate request body
        const { gameId, gameName, bajiId, bajiName, betType, digit, amount, userId } = req.body;
  
      // Validate required fields
        if (!gameId || !bajiId || !betType || !digit || !userId || !amount) {
            return res.status(400).send({ error: "Missing required fields." });
        }
  
        // Validate amount and digit
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).send({ error: "Invalid amount. Must be a positive number." });
        }

        // Validate bet amount range based on betType
        if (betType === 'Single') {
            if (amount < 5 || amount > 10000) {
                return res.status(400).send({ error: "For Single bet type, amount must be between 5 and 10000." });
            }
        } else if (betType === 'Jodi' || betType === 'Patti') {
            if (amount < 5 || amount > 50) {
                return res.status(400).send({ error: "For Jodi or Patti bet types, amount must be between 5 and 50." });
            }
        }
    
        if (!/^\d+$/.test(digit)) {
            return res.status(400).send({ error: "Invalid digit. Must contain only numeric characters." });
        }

      
        // Get reference to the user's document in Firestore
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        // Check if the user exists
        if (!userDoc.exists) {
        return res.status(404).send({ error: "User not found." });
        }

        const userData = userDoc.data();
        const currentBalance = userData.balance || 0;

        // Check if the user has enough balance to place the bet
        if (currentBalance < amount) {
        return res.status(400).send({ error: "Insufficient balance to place the bet." });
        }

        // Deduct the bet amount from the user's balance
        await userRef.update({
        balance: admin.firestore.FieldValue.increment(-amount), // Subtract the amount
        });
  
        // Add bet details to the Firestore subcollection
        const betDetails = {
            userId: userId,
            gameName,
            bajiName,
            betDigit: digit,
            betAmount: parseFloat(amount),
            verified: false,
            betStatus:'',
            winningPrice:'',

            createdAt: admin.firestore.Timestamp.now(),
        };
  
        await db
            .collection(`games/${gameId}/baji/${bajiId}/${betType}`)
            .add(betDetails);
  
        return res.status(200).send({ message: "Bet added successfully." });
    } catch (error) {
        console.error("Error adding bet:", error);
        return res.status(500).send({ error: "Failed to add bet details." });
    }
});

exports.setWinningDigit = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        try {
            if (req.method !== 'POST') {
                return res.status(405).send({ error: 'Method Not Allowed' });
            }
            // Parse request body
            const { selectedGameId, selectedBajiId, selectedBetType, winningDigit } = req.body;

        // Validate required fields
        if (!selectedGameId || !selectedBajiId || !selectedBetType || !winningDigit) {
        return res.status(400).send({ error: "Please select a game, a Baji, a bet type, and enter a winning digit." });
        }

        const resultDate = new Date().toISOString(); // Current date as resultDate

            // Reference to the selected Baji document
            const bajiDocRef = db.collection(`games/${selectedGameId}/baji`).doc(selectedBajiId);

            // Check if a winning digit has already been set for the selected bet type on the same day
            const bajiDoc = await bajiDocRef.get();


            if (!bajiDoc.exists) {
                return res.status(404).send({ error: `Baji with ID ${selectedBajiId} not found.` });
            }

            const currentTime = new Date();
            const currentHour = currentTime.getHours();
            const currentMinute = currentTime.getMinutes();
            const currentDayOfWeek = currentTime.getDay(); // 0 (Sunday) to 6 (Saturday)

            const activeDays = bajiDoc.data()?.activeDays || [];

            if (!activeDays.includes(currentDayOfWeek)) {
                return res.status(400).send({ 
                    error: `Results cannot be set on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDayOfWeek]}. This Baji is not active on this day.` 
                });
            }
            

            //  // Define the end time for the day (e.g., 01:00 AM)
            //  const endTimeParts = bajiDoc.data()?.endTime.split(':'); // 01:00 (1:00 AM)
            //  const endTimeHour = parseInt(endTimeParts[0], 10);
            //  const endTimeMinute = parseInt(endTimeParts[1], 10);
 
            //  // Check if current time is after endTime (01:00 AM)
            //  const isAfterEndTime = (currentHour > endTimeHour) || (currentHour === endTimeHour && currentMinute >= endTimeMinute);
             
            //  if (!isAfterEndTime) {
            //      return res.status(400).send({ 
            //          error: `Results can only be set after ${endTimeHour}:${endTimeMinute.toString().padStart(2, '0')}.` 
            //      });
            //  }



            const existingWinningDigits = bajiDoc.data()?.winningDigits || {};
        
            if (
                existingWinningDigits[selectedBetType] &&
                existingWinningDigits[selectedBetType].some((entry) => entry.resultDate.split('T')[0] === resultDate.split('T')[0])
            ) {
                return res.status(400).send({
                    error: `A winning digit has already been set for ${selectedBetType} on ${resultDate}. Only one winning digit is allowed per bet type per day.`,
                });
            }

            // Append a new object to the array for the selected bet type
            await bajiDocRef.update({
            [`winningDigits.${selectedBetType}`]: admin.firestore.FieldValue.arrayUnion({ digit: winningDigit, resultDate }),
            });

            // Now, let's update the betStatus for each user based on the winning digit
            const betQuerySnapshot = await db
            .collection(`games/${selectedGameId}/baji/${selectedBajiId}/${selectedBetType}`)
            .get();

            const batch = db.batch(); // We will use a batch to make all updates in one request for efficiency

            // Use a for...of loop instead of forEach to handle async operations correctly
            for (const betDoc of betQuerySnapshot.docs) {
                const betData = betDoc.data();
                const betDigit = betData.betDigit;
                const userId = betData.userId;
                const betAmount = betData.betAmount;

                // Determine the bet status
                let betStatus = betDigit === winningDigit ? 'win' : 'loss';

                // Update the bet status in the subcollection
                batch.update(betDoc.ref, { betStatus });

                // Calculate the winning price based on betType
                let winningPrice = betAmount;

                // If the bet was a win, update the user's balance
                if (betStatus === 'win') {
                    if (selectedBetType === 'Single') {
                        winningPrice = betAmount * 9;
                    } else if (selectedBetType === 'Jodi') {
                        winningPrice = betAmount * 80;
                    } else if (selectedBetType === 'Patti') {
                        winningPrice = betAmount * 100;
                    }

                    const userRef = db.collection('users').doc(userId);
                    await userRef.update({
                        balance: admin.firestore.FieldValue.increment(parseFloat(winningPrice.toFixed(2))),
                    });

                    // Update the 'earned' field or create it if it doesn't exist
                    await userRef.set({
                        earned: admin.firestore.FieldValue.increment(parseFloat(winningPrice.toFixed(2))),
                    }, { merge: true }); // Merge ensures it won't overwrite other fields

                    // Ensure the winningPrice field is created, then update the bet document with the calculated winningPrice
                    batch.update(betDoc.ref, { winningPrice: parseFloat(winningPrice.toFixed(2)) });
                }
            }

            // Commit the batch update
            await batch.commit();

            // Return success response
            return res.status(200).send({ message: "Winning digit set successfully and bet statuses updated!" });

        } catch (error) {
            console.error("Error setting winning digit:", error);
            return res.status(500).send({ error: "Failed to set the winning digit." });
        }
    });
});

exports.getAllGamesWithBetData = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        try {
            const { gameId, bajiId, betType } = req.query;
            const gamesData = [];

            // Get today's timestamp at midnight (start of the day) in Indian Standard Time (IST)
            const now = new Date();
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            const todayTimestamp = admin.firestore.Timestamp.fromDate(midnight);

            const gamesSnapshot = gameId 
                ? await db.collection('games').doc(gameId).get()
                : await db.collection('games').get();

            if (!gameId && gamesSnapshot.empty) {
                return res.status(200).send({ games: [] });
            }

            const gameDocs = gameId ? [gamesSnapshot] : gamesSnapshot.docs;

            for (const gameDoc of gameDocs) {
                if (!gameDoc.exists) continue;
                const currentGameId = gameDoc.id;
                const gameData = { ...gameDoc.data(), gameId: currentGameId };

                const bajisData = [];
                let gameTotalBetAmount = 0;
                let gameTotalWinningPrice = 0;

                const bajisSnapshot = bajiId 
                    ? await db.collection(`games/${currentGameId}/baji`).doc(bajiId).get()
                    : await db.collection(`games/${currentGameId}/baji`).get();

                const bajiDocs = bajiId ? [bajisSnapshot] : bajisSnapshot.docs;

                for (const bajiDoc of bajiDocs) {
                    if (!bajiDoc.exists) continue;
                    const currentBajiId = bajiDoc.id;
                    const bajiData = { ...bajiDoc.data(), bajiId: currentBajiId };

                    let bajiTotalBetAmount = 0;
                    let bajiTotalWinningPrice = 0;
                    const betTypesData = [];

                    const betTypes = betType ? [betType] : ['Single', 'Jodi', 'Patti'];
                    for (const currentBetType of betTypes) {
                        const betsSnapshot = await db.collection(`games/${currentGameId}/baji/${currentBajiId}/${currentBetType}`)
                        .where('createdAt', '>=', todayTimestamp) // Filter for current day's bets only in IST using timestamp
                        .get();

                        let betTypeTotalBetAmount = 0;
                        let betTypeTotalWinningPrice = 0;
                        const betsData = [];

                        // Initialize the digit counts for the range of the bet type
                        const digitRange = currentBetType === 'Single' ? 10 : currentBetType === 'Jodi' ? 100 : 1000;
                        const digitCounts = Array.from({ length: digitRange }, (_, i) => ({ 
                            digit: i.toString(), 
                            userCount: 0, 
                            digitTotalBetPrice: 0, // Initialize with 0
                        }));

                        // To track unique users for each digit
                        const usersPerDigit = {};

                        if (!betsSnapshot.empty) {
                            betsSnapshot.docs.forEach((betDoc) => {
                                const betData = { ...betDoc.data(), betId: betDoc.id };
                                betsData.push(betData);

                                const betAmount = betData.betAmount || 0;
                                const winningPrice = betData.winningPrice || 0;
                                const betDigit = parseInt(betData.betDigit, 10); // Convert betDigit to integer
                                const userId = betData.userId;

                                betTypeTotalBetAmount += betAmount;
                                betTypeTotalWinningPrice += !isNaN(winningPrice) ? parseFloat(winningPrice) : 0;

                                // Check if the betDigit is within the range
                                if (!isNaN(betDigit) && betDigit >= 0 && betDigit < digitRange) {
                                    if (!usersPerDigit[betDigit]) {
                                        usersPerDigit[betDigit] = new Set();
                                    }
                                    usersPerDigit[betDigit].add(userId);
                                    digitCounts[betDigit].digitTotalBetPrice += betAmount; // Add bet amount to the digit
                                }
                            });

                            // Count the unique users for each digit
                            for (const [digit, userSet] of Object.entries(usersPerDigit)) {
                                const count = userSet.size;
                                const digitIndex = parseInt(digit, 10);
                                if (!isNaN(digitIndex) && digitIndex >= 0 && digitIndex < digitRange) {
                                    digitCounts[digitIndex].userCount = count;
                                }
                            }
                        }

                        betTypesData.push({
                            betType: currentBetType,
                            bets: betsData,
                            totalBetAmount: betTypeTotalBetAmount,
                            totalWinningPrice: betTypeTotalWinningPrice,
                            digitCounts, // Include the list of digit counts with user counts
                        });

                        bajiTotalBetAmount += betTypeTotalBetAmount;
                        bajiTotalWinningPrice += betTypeTotalWinningPrice;
                    }

                    bajisData.push({
                        ...bajiData,
                        totalBetAmount: bajiTotalBetAmount,
                        totalWinningPrice: bajiTotalWinningPrice,
                        betTypes: betTypesData,
                    });

                    gameTotalBetAmount += bajiTotalBetAmount;
                    gameTotalWinningPrice += bajiTotalWinningPrice;
                }

                gamesData.push({
                    ...gameData,
                    totalBetAmount: gameTotalBetAmount,
                    totalWinningPrice: gameTotalWinningPrice,
                    bajis: bajisData,
                });
            }

            return res.status(200).send({
                message: "Games data retrieved successfully.",
                games: gamesData,
                currentTime: todayTimestamp
            });
        } catch (error) {
            console.error("Error retrieving games data:", error);
            return res.status(500).send({ error: "Failed to retrieve games data." });
        }
    });
});

exports.fetchAllBettingHistory = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
    try {
        // Fetch all games
        const gamesSnapshot = await db.collection('games').get();
        if (gamesSnapshot.empty) {
            return res.status(404).send({ message: "No games found." });
        }

        const allBettingHistory = [];

        // Iterate through each game
        for (const gameDoc of gamesSnapshot.docs) {
            const gameId = gameDoc.id;

            // Fetch all bajis within the game
            const bajisSnapshot = await db.collection(`games/${gameId}/baji`).get();
            if (bajisSnapshot.empty) {
                continue; // Skip games without bajis
            }

            for (const bajiDoc of bajisSnapshot.docs) {
                const bajiId = bajiDoc.id;

                // Iterate through each bet type
                const betTypes = ['Single', 'Jodi', 'Patti'];
                for (const betType of betTypes) {
                    const betsSnapshot = await db.collection(`games/${gameId}/baji/${bajiId}/${betType}`).get();

                    if (!betsSnapshot.empty) {
                        const betsList = betsSnapshot.docs.map((doc) => ({
                            id: doc.id,
                            gameId,
                            bajiId,
                            betType,
                            ...doc.data(),
                        }));

                        allBettingHistory.push(...betsList);
                    }
                }
            }
        }

        // Return all collected betting history
        return res.status(200).send({ bettingHistory: allBettingHistory });
    } catch (error) {
        console.error("Error fetching all betting history:", error);
        return res.status(500).send({ error: "Failed to fetch all betting history." });
    }
});
});

exports.getAllBalanceHistory = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
    try {
      // Fetch all user documents from the 'users' collection
      const usersSnapshot = await db.collection('users').get();
  
      // Initialize an array to store the balance history of all users
      const allBalanceHistory = [];
  
      // Iterate through each user document
      usersSnapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        const userId = userDoc.id;
  
        // Extract balanceHistory for the user
        const balanceHistory = userData.balanceHistory || [];
  
        // Append user's balance history with userId to the array
        allBalanceHistory.push({
          userId,
          balanceHistory,
        });
      });
  
      // Return the aggregated balance history as the response
      return res.status(200).send({ message: 'Balance history retrieved successfully.', data: allBalanceHistory });
    } catch (error) {
      console.error('Error retrieving balance history:', error);
      return res.status(500).send({ error: 'Failed to retrieve balance history' });
    }
})
  });

exports.getCombinedHistory = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        try {
            // Get the optional userId filter from query parameters
            const userIdFilter = req.query.userId || null;
            // Fetch all user documents from the 'users' collection
            const usersSnapshot = await db.collection('users').get();
            const allBalanceHistory = [];


    // Aggregate deposit and withdraw history for all users
    usersSnapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        const userId = userDoc.id;
        // If userIdFilter is provided, skip users that do not match the filter
        if (userIdFilter && userId !== userIdFilter) {
            return;
        }

        // const allUserData = userData
        const balanceHistory = userData.balanceHistory || [];

   

                balanceHistory.forEach((entry) => {
                    allBalanceHistory.push({
                        ...entry,
                        userId, // Keep userId for filtering purpose
                        firstName:userData.firstName,
                        lastName: userData.lastName,
                        userMobileNumber: userData.phone,
                        userName: "dummy",
                        type: entry.type, // 'deposit' or 'withdraw'
                        timestamp: entry.requestedAt, // Convert Firestore timestamp to milliseconds
                    });
                });
            });


            // Fetch all games
            const gamesSnapshot = await db.collection('games').get();
            if (gamesSnapshot.empty) {
                console.warn("No games found.");
            }

            const allBettingHistory = [];

            // Aggregate betting history for all games
            for (const gameDoc of gamesSnapshot.docs) {
                const gameId = gameDoc.id;

                // Fetch all bajis within the game
                const bajisSnapshot = await db.collection(`games/${gameId}/baji`).get();
                if (bajisSnapshot.empty) {
                    continue; // Skip games without bajis
                }

                for (const bajiDoc of bajisSnapshot.docs) {
                    const bajiId = bajiDoc.id;

                    // Iterate through each bet type
                    const betTypes = ['Single', 'Jodi', 'Patti'];
                    for (const betType of betTypes) {
                        const betsSnapshot = await db.collection(`games/${gameId}/baji/${bajiId}/${betType}`).get();

                        if (!betsSnapshot.empty) {
                        const betsList = betsSnapshot.docs.map((doc) => {
                            const betData = doc.data();
                            const userId = betData.userId; // Assuming `userId` is stored in bets

                            // If userIdFilter is provided, skip bets that do not match the filter
                            if (userIdFilter && userId !== userIdFilter) {
                                return null;
                            }

                            return {
                                id: doc.id,
                                gameId,
                                gameName: betData.gameName,
                                bajiId,
                                bajiName: betData.bajiName,
                                betType,
                                timestamp: betData.createdAt, // Convert Firestore timestamp to milliseconds
                                userId, // Keep userId for filtering purpose
                                ...betData,
                                type: 'bet',
                            };
                        });

                        // allBettingHistory.push(...betsList);
                        allBettingHistory.push(...betsList.filter(Boolean)); // Filter out null values
                        }
                    }
                }
            }

    // Combine all histories (balance and betting)
    let combinedHistory = [...allBalanceHistory, ...allBettingHistory];
    combinedHistory = combinedHistory.filter(entry => entry && entry.timestamp);
    // Sort combined history by timestamp (descending)
    combinedHistory.sort((a, b) => b.timestamp - a.timestamp);

            // Return the combined history
            return res.status(200).send({
                message: 'Combined history retrieved successfully.',
                data: combinedHistory,
            });
        } catch (error) {
            console.error("Error retrieving combined history:", error);
            return res.status(500).send({ error: "Failed to retrieve combined history." });
        }
    });
});

exports.addGame = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        const { title } = req.body;

        if (!title) {
            return res.status(400).send({ error: "Game title is required." });
        }

        try {
            // Add a new game document to the 'games' collection
            const docRef = await db.collection('games').add({
                title,
                createdAt: admin.firestore.Timestamp.now()
            });

            // Respond with the new game ID and title
            return res.status(201).send({
                message: "Game added successfully.",
                game: {
                    id: docRef.id,
                    title,
                },
            });
        } catch (error) {
            console.error("Error adding game:", error);
            return res.status(500).send({ error: "Failed to add game." });
        }
    });
});

exports.createLotoGame = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
    try {
        if (req.method !== 'POST') {
            return res.status(405).send({ error: 'Method Not Allowed' });
        }
        // Check if a game of type 'loto' already exists
        const existingGameSnapshot = await db.collection('games')
        .where('type', '==', 'loto')
        .limit(1) // Only check for the existence of 1 document
        .get();

        if (!existingGameSnapshot.empty) {
            return res.status(200).send({ 
                message: 'A Loto game already exists.' 
            });
        }

        // Prepare the new game data
        const newGameData = {
            title:"Loto Game",
            type: 'loto',  // Fixed game type as 'Loto'
            gameHistory: [], // Empty array to hold bet history
            createdAt: admin.firestore.FieldValue.serverTimestamp() // Timestamp of when the game was created
        };

        // Add new game document to the 'games' collection
        const gameRef = await db.collection('games').add(newGameData);

        return res.status(201).send({
            message: 'Loto game created successfully.',
            gameId: gameRef.id,
            gameData: newGameData
        });

    } catch (error) {
        console.error('Error creating Loto game:', error);
        return res.status(500).send({ error: 'Failed to create Loto game.' });
    }
})
});

exports.fetchLotoGame = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
      try {
        if (req.method !== 'GET') {
          return res.status(405).send({ error: 'Method Not Allowed' });
        }
  
        // Query Firestore to get Loto games where type = 'loto'
        const snapshot = await db.collection('games')
          .where('type', '==', 'loto')
          .limit(1) // Get the latest Loto game
          .get();
  
        if (snapshot.empty) {
          return res.status(200).send({
            message: 'No Loto game found.',
            games: [] 
          });
        }
  
        // Map the Firestore documents into a usable array of game objects
        const games = snapshot.docs.map(doc => {
          const data = doc.data();
          const gameHistory = data.gameHistory || [];

          let totalGameBetAmount = 0;
          let totalGameWinningPrice = 0;
  
          // For each bet in gameHistory, calculate totalBetAmount and totalWinningPrice for the userList
          const updatedGameHistory = gameHistory.map(bet => {
            const userList = bet.userList || [];
            
            let totalBetAmount = 0;
            let totalWinningPrice = 0;
  
            userList.forEach(user => {
              totalBetAmount += user.amount || 0;
              totalWinningPrice += user.winningPrice || 0;
            });

            // Add each bet's totals to the total for the entire game
            totalGameBetAmount += totalBetAmount;
            totalGameWinningPrice += totalWinningPrice;
  
            return {
              ...bet,
              totalBetAmount, // Total amount of all bets in this specific bet
              totalWinningPrice // Total winning price for this specific bet
            };
          });
  
          return {
            id: doc.id,
            ...data,
            lotoGameStatus: true, // Set to true if gameHistory exists and is not empty
            gameHistory: updatedGameHistory, // Attach updated gameHistory with totalBetAmount and totalWinningPrice for each bet
            totalGameBetAmount, // Total bet amount for the entire game
          totalGameWinningPrice // Total winning price for the entire game
          };
        });
  
        return res.status(200).send({
          message: 'Loto game fetched successfully.',
          games
        });
  
      } catch (error) {
        console.error('Error fetching Loto game:', error);
        return res.status(500).send({ error: 'Failed to fetch Loto game.' });
      }
    });
  });


  exports.startLotoGameWithBet = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
    try {
        if (req.method !== 'POST') {
            return res.status(405).send({ error: 'Method Not Allowed' });
        }

        const { gameId } = req.body;

        // Validate required fields
        if (!gameId) {
            return res.status(400).send({
                error: 'Missing required field: gameId'
            });
        }

        // Reference to the specific game document
        const gameRef = db.collection('games').doc(gameId);

        // Fetch the game data
        const gameDoc = await gameRef.get();
        if (!gameDoc.exists) {
            return res.status(404).send({ error: 'Game not found.' });
        }

        const gameData = gameDoc.data();

        // Get the latest bet from gameHistory based on createdAt timestamp
        const gameHistory = gameData.gameHistory || [];

        let latestBet = null;
        if (gameHistory.length > 0) {
            // Find the latest bet by createdAt timestamp
            latestBet = gameHistory.reduce((latest, bet) => {
                return latest.createdAt?.toDate() > bet.createdAt?.toDate() ? latest : bet;
            });
        }

        // Check if the latest bet exists and is within 10 minutes of the current time
        if (latestBet) {
            const lastBetCreatedAt = latestBet.createdAt?.toDate(); // Ensure it's a Date object
            if (lastBetCreatedAt) {
                // Calculate the time difference between now and the last bet's createdAt
                const timeDifference = new Date() - lastBetCreatedAt;

                // Check if the time difference is within 10 minutes (600,000 milliseconds)
                if (timeDifference <= 10 * 60 * 1000) {
                    return res.status(400).send({ error: 'Game has already started.' });
                }
            }
        }

        // Calculate start and end times
        const startTime = admin.firestore.Timestamp.now(); // Use Firestore timestamp
        const endTime = admin.firestore.Timestamp.fromMillis(startTime.toMillis() + 10 * 60000); // 10 minutes from start time

        // Create a new bet entry
        const newBet = {
            startTime, // Start time of the game
            endTime, // End time (10 minutes after start)
            createdAt: admin.firestore.Timestamp.now(),
        };

        // Update the game document by adding the new bet to the gameHistory
        await gameRef.update({
            gameHistory: admin.firestore.FieldValue.arrayUnion(newBet),
            updatedAt: admin.firestore.Timestamp.now(),
        });

        return res.status(200).send({
            message: 'Loto game started and bet added to game history successfully.',
            gameId: gameId,
            newBet: newBet,
        });

    } catch (error) {
        console.error('Error starting Loto game and adding bet:', error);
        return res.status(500).send({ error: 'Failed to start Loto game and add bet.' });
    }
})
});

exports.setLotoGameResult = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
      try {
        if (req.method !== 'POST') {
          return res.status(405).send({ error: 'Method Not Allowed' });
        }
  
        const { betDigit, gameId } = req.body;
  
        // Validate required fields
        if (!gameId) {
          return res.status(400).send({ error: 'Missing required field: gameId' });
        }
  
        // Reference to the game document
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();
  
        if (!gameDoc.exists) {
          return res.status(404).send({ error: 'Game not found.' });
        }
  
        const gameData = gameDoc.data();
        const gameHistory = gameData.gameHistory || [];
  
        if (gameHistory.length === 0) {
          return res.status(400).send({ error: 'No bets found for this game.' });
        }
  
        // Find the latest bet from gameHistory
        const latestBetIndex = gameHistory.reduce((latestIndex, bet, index) => {
          const latestBetTime = gameHistory[latestIndex]?.createdAt?.toDate() || new Date(0);
          const currentBetTime = bet?.createdAt?.toDate() || new Date(0);
          return currentBetTime > latestBetTime ? index : latestIndex;
        }, 0);

  
        const latestBet = gameHistory[latestBetIndex];
        const currentTime = new Date();
        const endTime = latestBet?.endTime?.toDate(); // Ensure it's a Date object
  
        if (!endTime) {
          return res.status(400).send({ error: 'End time for the latest bet is not available.' });
        }
  
        // Calculate the time difference in milliseconds
        const timeDifference = currentTime - endTime;
  
        // If current time is more than 2 minutes past the endTime, generate a random result if not provided
        let finalResultDigit = betDigit;
        if (!finalResultDigit && timeDifference > 2 * 60 * 1000) {
          finalResultDigit = Math.floor(Math.random() * 1000).toString().padStart(3, '0'); // Generate 000 to 999
        }
  
        if (!finalResultDigit) {
          return res.status(400).send({ error: 'No result digit provided and the time difference is not sufficient to auto-generate one.' });
        }

        const singleDigit = finalResultDigit.charAt(0);
        const doubleDigit = finalResultDigit.slice(0, 2);
        const tripleDigit = finalResultDigit;

        // Update the resultDigit of the latest bet in the gameHistory
        const updatedUserList = latestBet?.userList?.map(userBet => {
            const { userId, betDigit: userBetDigit, amount } = userBet;
            
            let isWinner = false;
            let winningPrice = 0;

             // Check win conditions based on selectedBetType
            if (userBetDigit === singleDigit) {
                isWinner = true;
                winningPrice = amount * 9;
            } else if (userBetDigit === doubleDigit) {
                isWinner = true;
                winningPrice = amount * 80;
            } else if (userBetDigit === tripleDigit) {
                isWinner = true;
                winningPrice = amount * 100;
            }

            if (isWinner) {
                // Update user's balance in Firestore
                const userRef = db.collection('users').doc(userId);
                userRef.get().then(async userDoc => {
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    const currentBalance = userData.balance || 0;
                    const newBalance = currentBalance + parseFloat(winningPrice.toFixed(2));

                    // Update user's balance
                await userRef.update({ balance: newBalance });

                // **Update the 'earned' field**
                await userRef.set({
                    earned: admin.firestore.FieldValue.increment(parseFloat(winningPrice.toFixed(2))),
                }, { merge: true });
    
                    // Update user's balance
                    // return userRef.update({ balance: newBalance });
                    // return userRef.update({ balance: newBalance });
                } else {
                    console.warn(`User with ID ${userId} not found.`);
                }
                }).catch(error => {
                console.error(`Error updating balance for userId ${userId}:`, error);
                });
            }
            // Filter out undefined fields from the user bet object
            const updatedUserBet = {
                ...userBet,
                isWinner: isWinner ?? false, // Ensure it's a boolean
                winningPrice: isWinner ? parseFloat(winningPrice.toFixed(2)) : 0, // Ensure it's a number
            };

            // Remove any undefined values from the userBet object
            Object.keys(updatedUserBet).forEach(key => {
                if (updatedUserBet[key] === undefined) {
                    delete updatedUserBet[key];
                }
            });
            return updatedUserBet;

            // return {
            //     ...userBet,
            //     isWinner,
            //     winningPrice: isWinner ? parseFloat(winningPrice.toFixed(2)) : 0,
            //   };
        });
  
        // Update the resultDigit of the latest bet in the gameHistory
        gameHistory[latestBetIndex] = {
          ...latestBet,
          resultDigit: finalResultDigit, // Update the resultDigit
          userList: updatedUserList || [] // Update the userList with win/loss info
        };
  
        // Update the game document with the new game history
        await gameRef.update({
          gameHistory: gameHistory,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), // Update timestamp
        });
  
        return res.status(200).send({
          message: 'Loto game result set successfully for the latest bet.',
          gameId: gameId,
          resultDigit: finalResultDigit,
          updatedBet: gameHistory[latestBetIndex],
        });
  
      } catch (error) {
        console.error('Error setting Loto game result:', error);
        return res.status(500).send({ error: 'Failed to set Loto game result.' });
      }
    });
  });


exports.getLiveGameStatus = functions.https.onRequest(async (req, res) => {
cors(req, res, async () => {
    try {
    if (req.method !== 'GET') {
        return res.status(405).send({ error: 'Method Not Allowed' });
    }

    // Reference to the 'games' collection
    const gamesRef = db.collection('games');

    // Get the latest game (assuming latest game is the most recently updated one)
    const latestGameSnapshot = await gamesRef.where('type', '==', 'loto').limit(1).get();

    if (latestGameSnapshot.empty) {
        return res.status(404).send({ error: 'No game found.' });
    }

    const latestGameDoc = latestGameSnapshot.docs[0];
    const gameData = latestGameDoc.data();
    const gameId = latestGameDoc.id;

    // Get the latest bet from gameHistory based on createdAt timestamp
    const gameHistory = gameData.gameHistory || [];

    let latestBet = null;
    if (gameHistory.length > 0) {
        // Find the latest bet by createdAt timestamp
        latestBet = gameHistory.reduce((latest, bet) => {
            return latest.createdAt?.toDate() > bet.createdAt?.toDate() ? latest : bet;
        });
    }

    const currentTime = new Date();

    if (!latestBet) {
        return res.status(400).send({ error: 'No bets found for this game.' });
    }

    const startTime = latestBet?.startTime?.toDate(); // Convert to Date object
    const endTime = latestBet?.endTime?.toDate(); // Convert to Date object

    if (!startTime || !endTime) {
        return res.status(400).send({ error: 'Start time or end time for the latest bet is not available.' });
    }

    // Check if the current time is between startTime and endTime
    const isLive = currentTime >= startTime && currentTime <= endTime;

    if (isLive) {
        // Calculate the remaining time in seconds
        const remainingTime = Math.max(0, Math.floor((endTime - currentTime) / 1000)); // Ensuring non-negative time

        return res.status(200).send({
        message: 'Live game found.',
        gameId: gameId,
        isLive: true,
        remainingTime: remainingTime, // Time left in seconds
        currentTime: currentTime,
        startTime: startTime,
        endTime: endTime,
        });
    } else if (currentTime > endTime) {
        // If the current time is after the end time, check for the winning digit
        const winningDigit = latestBet.resultDigit || null;

        if (winningDigit) {
        return res.status(200).send({
            message: 'Game has ended, and the winning digit is available.',
            gameId: gameId,
            isLive: false,
            winningDigit: winningDigit, 
            currentTime: currentTime,
            startTime: startTime,
            endTime: endTime,
        });
        } else {
        return res.status(200).send({
            message: 'Game has ended, but the winning digit is not available yet.',
            gameId: gameId,
            isLive: false,
            currentTime: currentTime,
            startTime: startTime,
            endTime: endTime,
        });
        }
    } else {
        return res.status(404).send({ 
        message: 'No live game currently running.',
        gameId: gameId,
        currentTime: currentTime,
        startTime: startTime,
        endTime: endTime,
        });
    }

    } catch (error) {
    console.error('Error retrieving live game status:', error);
    return res.status(500).send({ error: 'Failed to retrieve live game status.' });
    }
});
});

exports.addBetToLatestGame = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
      try {
        if (req.method !== 'POST') {
          return res.status(405).send({ error: 'Method Not Allowed. Use POST request.' });
        }
  
        const { gameId, userId, amount, betDigit } = req.body;
  
        // Validate required fields
        if (!gameId || !userId || !amount || !betDigit) {
          return res.status(400).send({ error: 'Missing required fields. gameId, userId, amount, and betDigit are required.' });
        }

            // Reference to the user document
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send({ error: 'User not found.' });
        }

        const userData = userDoc.data();
        const currentBalance = userData.balance || 0;

        // Check if the user has enough balance to place the bet
        if (currentBalance < amount) {
            return res.status(400).send({ 
            error: 'Insufficient balance. Please check your balance and try again.' 
            });
        }

        // Deduct the bet amount from the user's balance
        const newBalance = currentBalance - amount;

        // Update the user's balance
        await userRef.update({
            balance: newBalance,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
  
        // Reference to the game document
        const gameRef = db.collection('games').doc(gameId);
        const gameDoc = await gameRef.get();
  
        if (!gameDoc.exists) {
          return res.status(404).send({ error: 'Game not found.' });
        }
  
        const gameData = gameDoc.data();
        const gameHistory = gameData.gameHistory || [];
  
        if (gameHistory.length === 0) {
          return res.status(400).send({ error: 'No bets found for this game.' });
        }
  
        // Find the latest bet from gameHistory
        const latestBetIndex = gameHistory.reduce((latestIndex, bet, index) => {
          const latestBetTime = gameHistory[latestIndex]?.createdAt?.toDate() || new Date(0);
          const currentBetTime = bet?.createdAt?.toDate() || new Date(0);
          return currentBetTime > latestBetTime ? index : latestIndex;
        }, 0);
  
        const latestBet = gameHistory[latestBetIndex];

         // Get the server timestamp from Firestore
        const serverTimestamp = new Date();
  
        // Add new bet to the userList of the latest bet
        const newUserBet = {
          userId,
          amount,
          betDigit,
          createdAt: serverTimestamp, // Timestamp for when the bet is added
        };
  
        // Check if userList exists, if not, initialize it as an array
        if (!latestBet.userList) {
          latestBet.userList = [];
        }
  
        // Add the new user's bet to the userList
        latestBet.userList.push(newUserBet);
  
        // Update the gameHistory array with the modified latest bet
        gameHistory[latestBetIndex] = latestBet;
  
        // Update the game document with the modified game history
        await gameRef.update({
          gameHistory: gameHistory,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), // Update timestamp
        });
  
        return res.status(200).send({
          message: 'Bet added successfully to the latest bet.',
          gameId: gameId,
          newBet: newUserBet,
          updatedLatestBet: gameHistory[latestBetIndex],
        });
  
      } catch (error) {
        console.error('Error adding bet to the latest game:', error);
        return res.status(500).send({ error: 'Failed to add bet to the latest game.' });
      }
    });
  });

exports.fetchGroupedBetHistory = functions.https.onRequest(async (req, res) => {
cors(req, res, async () => {
    try {
    if (req.method !== 'GET') {
        return res.status(405).send({ error: 'Method Not Allowed' });
    }

    // Query Firestore to get all games of type 'loto'
    const snapshot = await db.collection('games')
        .where('type', '==', 'loto')
        .get();

    if (snapshot.empty) {
        return res.status(200).send({
        message: 'No Loto games found.',
        liveGameHistory: [],
        recentGamesHistory: []
        });
    }

    const createDigitCounts = (range) => {
        const digitCounts = [];
        for (let i = 0; i <= range; i++) {
        const digit = i.toString().padStart(range.toString().length, '0');
        digitCounts.push({
            digit: digit,
            userCount: 0,
            digitTotalBetPrice: 0
        });
        }
        return digitCounts;
    };

    const initializeGameHistory = (includeWinningPrice = false) => ({
        singleDigit: {
        totalBetAmount: 0,
        digitCounts: createDigitCounts(9),
        userList: [],
        ...(includeWinningPrice && { totalWinningPrice: 0 })
        },
        doubleDigit: {
        totalBetAmount: 0,
        digitCounts: createDigitCounts(99),
        userList: [],
        ...(includeWinningPrice && { totalWinningPrice: 0 })
        },
        tripleDigit: {
        totalBetAmount: 0,
        digitCounts: createDigitCounts(999),
        userList: [],
        ...(includeWinningPrice && { totalWinningPrice: 0 })
        }
    });

    const liveGameHistory = initializeGameHistory();
    const recentGamesHistory = initializeGameHistory(true);

    let grandTotalBetAmount = 0;
    let grandTotalWinningPrice = 0;

    snapshot.forEach(doc => {
        const gameData = doc.data();
        const gameHistory = gameData.gameHistory || [];

        let latestBet = null;
        if (gameHistory.length > 0) {
        latestBet = gameHistory.reduce((latest, bet) => {
            return latest.createdAt?.toDate() > bet.createdAt?.toDate() ? latest : bet;
        });
        }

        gameHistory.forEach(bet => {
        const userList = bet.userList || [];

        userList.forEach(userBet => {
            const betDigit = userBet.betDigit || '';
            const betAmount = userBet.amount || 0;
            const winningPrice = userBet.winningPrice || 0;

            let digitCategory;
            if (betDigit.length === 1) {
            digitCategory = 'singleDigit';
            } else if (betDigit.length === 2) {
            digitCategory = 'doubleDigit';
            } else if (betDigit.length === 3) {
            digitCategory = 'tripleDigit';
            } else {
            return;
            }

            liveGameHistory[digitCategory].totalBetAmount += betAmount;
            recentGamesHistory[digitCategory].totalBetAmount += betAmount;
            recentGamesHistory[digitCategory].totalWinningPrice += winningPrice;

            grandTotalBetAmount += betAmount;
            grandTotalWinningPrice += winningPrice;

            const userBetData = {
            userId: userBet.userId,
            betDigit: betDigit,
            amount: betAmount
            };

            liveGameHistory[digitCategory].userList.push(userBetData);
            recentGamesHistory[digitCategory].userList.push(userBetData);

            const updateDigitCounts = (digitCounts) => {
            const digitData = digitCounts.find(dc => dc.digit === betDigit);
            if (digitData) {
                digitData.userCount += 1;
                digitData.digitTotalBetPrice += betAmount;
            }
            };

            updateDigitCounts(liveGameHistory[digitCategory].digitCounts);
            updateDigitCounts(recentGamesHistory[digitCategory].digitCounts);
        });
        });
    });

    return res.status(200).send({
        message: 'Grouped bet history fetched successfully.',
        liveGameHistory: {
        ...liveGameHistory,
        grandTotalBetAmount: liveGameHistory.singleDigit.totalBetAmount + 
                            liveGameHistory.doubleDigit.totalBetAmount + 
                            liveGameHistory.tripleDigit.totalBetAmount,
        },
        recentGamesHistory: {
        ...recentGamesHistory,
        grandTotalBetAmount: recentGamesHistory.singleDigit.totalBetAmount + 
                            recentGamesHistory.doubleDigit.totalBetAmount + 
                            recentGamesHistory.tripleDigit.totalBetAmount,
        grandTotalWinningPrice: recentGamesHistory.singleDigit.totalWinningPrice + 
                                recentGamesHistory.doubleDigit.totalWinningPrice + 
                                recentGamesHistory.tripleDigit.totalWinningPrice,
        },
        grandTotalBetAmount,
        grandTotalWinningPrice
    });
    } catch (error) {
    console.error('Error fetching grouped bet history:', error);
    return res.status(500).send({ error: 'Failed to fetch grouped bet history.' });
    }
});
});
  
exports.fetchUserBetHistory = functions.https.onRequest(async (req, res) => {
cors(req, res, async () => {
    try {
    if (req.method !== 'GET') {
        return res.status(405).send({ error: 'Method Not Allowed' });
    }

    const userId = req.query.userId;
    
    if (!userId) {
        return res.status(400).send({ error: 'Missing userId in query params.' });
    }

    // Query Firestore to get all games of type 'loto'
    const snapshot = await db.collection('games')
        .where('type', '==', 'loto')
        .get();

    if (snapshot.empty) {
        return res.status(200).send({
        message: 'No Loto game found for this user.',
        betHistory: [] 
        });
    }

    // Array to store all bets of the user
    const userBetHistory = [];

    snapshot.forEach(doc => {
        const gameData = doc.data();
        const gameId = doc.id;
        const gameHistory = gameData.gameHistory || [];

        gameHistory.forEach(bet => {
        const userList = bet.userList || [];
        const startTime = bet.startTime || null

        // Filter the user's bets in each bet entry
        const userBets = userList.filter(user => user.userId === userId);

        userBets.forEach(userBet => {
            userBetHistory.push({
            gameId,
            createdAt: startTime || null,
            betDigit: userBet.betDigit || '',
            betAmount: userBet.amount || 0,
            winningPrice: userBet.winningPrice || 0,
            winningStatus: userBet.isWinner
            });
        });
        });
    });

    // Sort by the createdAt date in descending order (latest bets first)
    userBetHistory.sort((a, b) => b.createdAt - a.createdAt);

    return res.status(200).send({
        message: 'User bet history fetched successfully.',
        betHistory: userBetHistory
    });

    } catch (error) {
    console.error('Error fetching user bet history:', error);
    return res.status(500).send({ error: 'Failed to fetch user bet history.' });
    }
});
});
  

exports.editGame = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        const { gameId, title } = req.body;

        if (!gameId || !title) {
            return res.status(400).send({ error: "Game ID and title are required." });
        }

        try {
            // Reference the game document in the Firestore 'games' collection
            const gameRef = db.collection('games').doc(gameId);
            const gameDoc = await gameRef.get();

            if (!gameDoc.exists) {
                return res.status(404).send({ error: "Game not found." });
            }

            // Update the game document
            await gameRef.update({
                title,
                updatedAt: admin.firestore.Timestamp.now(),
            });

            return res.status(200).send({
                message: "Game updated successfully.",
                game: {
                    id: gameId,
                    title,
                },
            });
        } catch (error) {
            console.error("Error updating game:", error);
            return res.status(500).send({ error: "Failed to update game." });
        }
    });
});

exports.deleteGame = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        const { gameId } = req.body;

        if (!gameId) {
            return res.status(400).send({ error: "Game ID is required." });
        }

        try {
            // Reference the game document in the Firestore 'games' collection
            const gameRef = db.collection('games').doc(gameId);
            const gameDoc = await gameRef.get();

            if (!gameDoc.exists) {
                return res.status(404).send({ error: "Game not found." });
            }

            // Delete the game document
            await gameRef.delete();

            return res.status(200).send({
                message: "Game deleted successfully.",
            });
        } catch (error) {
            console.error("Error deleting game:", error);
            return res.status(500).send({ error: "Failed to delete game." });
        }
    });
});

exports.deleteBaji = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        try {
            // Extract gameId and bajiId from the request body
            const { gameId, bajiId } = req.body;

            // Validate required parameters
            if (!gameId || !bajiId) {
                return res.status(400).send({ error: "gameId and bajiId are required." });
            }

            // Reference to the baji collection
            const bajiRef = db.collection(`games/${gameId}/baji`).doc(bajiId);

            // Check if the baji exists
            const bajiDoc = await bajiRef.get();
            if (!bajiDoc.exists) {
                return res.status(404).send({ error: "Baji not found." });
            }

            // Delete all bets under the baji
            const betTypes = ['Single', 'Jodi', 'Patti']; // Assuming these are the bet type subcollections
            for (const betType of betTypes) {
                const betsSnapshot = await db.collection(`games/${gameId}/baji/${bajiId}/${betType}`).get();

                // Delete each bet in the bet type collection
                for (const betDoc of betsSnapshot.docs) {
                    await db
                        .collection(`games/${gameId}/baji/${bajiId}/${betType}`)
                        .doc(betDoc.id)
                        .delete();
                }
            }

            // Finally, delete the baji document
            await bajiRef.delete();

            return res.status(200).send({
                message: `Baji with ID ${bajiId} deleted successfully along with all associated bets.`,
            });
        } catch (error) {
            console.error("Error deleting baji:", error);
            return res.status(500).send({ error: "Failed to delete baji." });
        }
    });
});