import { useState } from "react";
import PlanetarySearchForm from "../features/PlanetaryResource/PlanetarySearchForm";
import ResourceResultTable from "../features/PlanetaryResource/ResourceResultTable";
import AccordionTip from "../ui/AccordionTip";
import TipForUse from "../features/PlanetaryResource/TipForUse";
function Planetary() {
  const [isSearching, setIsSearching] = useState(false);
  const [searchData, setSearchData] = useState([]);

  return (
    <>
      <AccordionTip title={"使用说明"}>
        <TipForUse />
      </AccordionTip>
      <PlanetarySearchForm
        setSearchData={setSearchData}
        setIsSearching={setIsSearching}
      />
      <ResourceResultTable isSearching={isSearching} searchData={searchData} />
    </>
  );
}

export default Planetary;
