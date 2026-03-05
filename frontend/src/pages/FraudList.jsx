import { useContext } from "react";
import FraudSearch from "../features/FraudList/FraudSearch";
import { isMobileContext } from "../context/IsMobileContext";
import MobileFraudSearch from "../features/FraudList/MobileFraudSearch";

function FraudList() {
  const { isMobile } = useContext(isMobileContext);
  return <>{isMobile ? <MobileFraudSearch /> : <FraudSearch />}</>;
}

export default FraudList;
