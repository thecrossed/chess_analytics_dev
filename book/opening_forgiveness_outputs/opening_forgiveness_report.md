# Opening Forgiveness MVP Report

## Data Source

- Games in manifest: 9
- Player-level rows: 18
- Threshold for primary mistake definition: 100 cp within the first 15 moves
- Final score is computed from the moving player's perspective.

## Sample Filters

- This MVP uses whatever games are listed in the manifest CSV.
- The primary opening window is the first 15 moves.
- Early mistake = at least one move with eval gap >= threshold.

## Main Result Snapshot

- Scandinavian Defense: clean=1.000, error=0.000, drop=1.000, n_clean=1, n_error=1
- Benoni Defense: clean=0.500, error=0.500, drop=0.000, n_clean=2, n_error=2
- Sicilian Defense: clean=0.333, error=0.667, drop=-0.333, n_clean=3, n_error=3
- English Opening: clean=0.000, error=1.000, drop=-1.000, n_clean=1, n_error=1

## Stratified Outputs

- Elo summary rows: 9
- Time-control summary rows: 6

## Regression

```text
OLS Regression Results                            
==============================================================================
Dep. Variable:            final_score   R-squared:                       0.411
Model:                            OLS   Adj. R-squared:                 -1.001
Method:                 Least Squares   F-statistic:                    0.2912
Date:                Thu, 02 Apr 2026   Prob (F-statistic):              0.963
Time:                        19:15:02   Log-Likelihood:                -7.2344
No. Observations:                  18   AIC:                             40.47
Df Residuals:                       5   BIC:                             52.04
Df Model:                          12                                         
Covariance Type:            nonrobust                                         
======================================================================================================================================
                                                                         coef    std err          t      P>|t|      [0.025      0.975]
--------------------------------------------------------------------------------------------------------------------------------------
Intercept                                                              0.2355      1.420      0.166      0.875      -3.414       3.885
C(opening_family)[T.English Opening]                                  -0.2706      1.376     -0.197      0.852      -3.807       3.266
C(opening_family)[T.Nimzo-Larsen Attack]                              -0.2974      1.083     -0.275      0.795      -3.081       2.487
C(opening_family)[T.Queen's Pawn Game]                                -0.3419      1.183     -0.289      0.784      -3.382       2.698
C(opening_family)[T.Scandinavian Defense]                              0.4891      1.345      0.364      0.731      -2.967       3.945
C(opening_family)[T.Sicilian Defense]                                 -0.3219      0.892     -0.361      0.733      -2.615       1.971
C(player_color)[T.white]                                              -0.3627      0.457     -0.794      0.463      -1.538       0.812
error_in_first_15_cp_100                                              -0.0331      0.693     -0.048      0.964      -1.813       1.747
C(opening_family)[T.English Opening]:error_in_first_15_cp_100          0.0471      1.795      0.026      0.980      -4.566       4.660
C(opening_family)[T.Nimzo-Larsen Attack]:error_in_first_15_cp_100  -9.379e-18   2.05e-15     -0.005      0.997   -5.28e-15    5.27e-15
C(opening_family)[T.Queen's Pawn Game]:error_in_first_15_cp_100    -1.743e-16   2.75e-16     -0.633      0.555   -8.82e-16    5.34e-16
C(opening_family)[T.Scandinavian Defense]:error_in_first_15_cp_100    -1.5793      1.425     -1.108      0.318      -5.243       2.084
C(opening_family)[T.Sicilian Defense]:error_in_first_15_cp_100         0.4451      1.140      0.390      0.712      -2.485       3.375
player_elo                                                             0.0006      0.001      0.749      0.487      -0.001       0.003
opp_elo                                                               -0.0003      0.001     -0.373      0.725      -0.003       0.002
==============================================================================
Omnibus:                        0.801   Durbin-Watson:                   2.471
Prob(Omnibus):                  0.670   Jarque-Bera (JB):                0.499
Skew:                          -0.389   Prob(JB):                        0.779
Kurtosis:                       2.756   Cond. No.                     2.49e+20
==============================================================================

Notes:
[1] Standard Errors assume that the covariance matrix of the errors is correctly specified.
[2] The smallest eigenvalue is 3.66e-33. This might indicate that there are
strong multicollinearity problems or that the design matrix is singular.
```

## Limitations

- Current conclusions depend entirely on the manifest input data.
- Per-move eval gap is used as the MVP mistake proxy; this is not yet normalized by position complexity.
- If the manifest contains only one opening family or one game, statistical comparison is not meaningful yet.
